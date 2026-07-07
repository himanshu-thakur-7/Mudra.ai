"""Processing-service consumer: drains ProcessJobs the Go fleet enqueues.

  uv run python -m app.workers.consumer            # block on the queue forever
  uv run python -m app.workers.consumer --drain    # process backlog, then exit

Per job: cascade extraction (native -> OCR) -> legal-structure chunking with
forced metadata -> draft chunk JSON under corpus/processed/drafts/ -> a
CorpusChangeEvent row (pending_review). Merging vetted clauses into
clauses.json stays a human step — corpus accuracy is the product.
"""

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import redis
from sqlalchemy import select

from app.core.config import CORPUS_DIR, get_settings
from app.core.db import get_session_factory, init_db
from app.models import CorpusChangeEvent
from app.services.corpus.chunker import extract_chunks, push_to_convex

# Supersession language + nearby circular references, surfaced as review hints.
SUPERSESSION_RE = re.compile(
    r"(supersede[sd]?|rescind(?:s|ed)?|repeal(?:s|ed)?|stands?\s+(?:repealed|rescinded|withdrawn)|"
    r"consolidat(?:e|es|ed)\s+and\s+replac(?:e|es|ed))",
    re.IGNORECASE,
)
# Matches refs like DOR.CRE.REC.66/21.07.001/2022-23, SEBI/HO/MIRSD/.../2023/51
CIRCULAR_REF_RE = re.compile(
    r"[A-Z]{2,10}[A-Z0-9.\-]*(?:/[A-Za-z0-9.\-]{1,25}){1,7}|circular\s+no\.?\s*[^\s,;]{4,50}",
    re.IGNORECASE,
)


def detect_supersession_hints(pages, limit: int = 5) -> list[dict]:
    hints = []
    for p in pages:
        for m in SUPERSESSION_RE.finditer(p.text):
            window = p.text[max(0, m.start() - 150): m.end() + 300]
            refs = [r.strip() for r in CIRCULAR_REF_RE.findall(window)][:4]
            hints.append({
                "page": p.page,
                "phrase": m.group(0),
                "context": " ".join(window.split())[:280],
                "refs": refs,
            })
            if len(hints) >= limit:
                return hints
    return hints

PROCESS_QUEUE = "ingest:process"
DEAD_LETTER_QUEUE = "ingest:process:failed"  # poison jobs parked here with their error
ACTIVITY_LIST = "ingest:activity"  # shared dashboard feed (same shape the Go fleet publishes)
DRAFTS_DIR = CORPUS_DIR / "processed" / "drafts"


def publish_activity(rdb, kind: str, detail: str, regulator: str = "") -> None:
    """Best-effort dashboard event; feed loss must never affect processing."""
    try:
        rdb.lpush(ACTIVITY_LIST, json.dumps({
            "ts": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "source": "consumer", "kind": kind, "regulator": regulator, "detail": detail,
        }))
        rdb.ltrim(ACTIVITY_LIST, 0, 499)
    except Exception:
        pass


def _set_doc_state(rdb, url: str, state: str, sha256: str = "") -> None:
    try:
        rdb.hset("ingest:docstate", url, json.dumps({
            "state": state, "sha256": sha256,
            "ts": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        }))
    except Exception:
        pass


def process_job(job: dict, rdb=None) -> CorpusChangeEvent | None:
    """Idempotent per sha256: re-delivered jobs are no-ops. Walks the doc
    through the state machine: DOWNLOADED -> PARSED -> CHUNKED."""
    init_db()
    db = get_session_factory()()
    try:
        existing = db.scalar(
            select(CorpusChangeEvent).where(CorpusChangeEvent.sha256 == job["sha256"])
        )
        if existing:
            return None

        # State-machine key = the URL the document was DISCOVERED at (the
        # detail/listing page on a two-hop crawl), matching the fleet's key.
        state_key = job.get("source_page") or job["url"]

        # Phase 3: PyMuPDF layout-aware parse → push straight to Convex. No local
        # vector storage, no drafts on disk — Convex is the sole store.
        doc_id = f"{job['regulator']}-{job['sha256'][:8]}"
        chunks = extract_chunks(job["pdf_path"], job["regulator"], doc_id, source_url=job["url"])
        if rdb is not None:
            _set_doc_state(rdb, state_key, "PARSED", job["sha256"])

        pushed = {"ingested": 0}
        if get_settings().convex_url or get_settings().convex_site_url:
            pushed = push_to_convex(chunks)

        event = CorpusChangeEvent(
            regulator=job["regulator"], url=job["url"], sha256=job["sha256"],
            pdf_path=job["pdf_path"], draft_path="",
            n_chunks=len(chunks), extraction_method="pymupdf",
            supersession_hints=[],
        )
        db.add(event)
        db.commit()
        if rdb is not None:
            _set_doc_state(rdb, state_key, "PUSHED_TO_CONVEX", job["sha256"])
        print(f"[consumer] {job['regulator']}: {len(chunks)} chunks parsed, {pushed.get('ingested', 0)} pushed to Convex")
        return event
    finally:
        db.close()


def run(drain: bool) -> None:
    settings = get_settings()
    rdb = redis.Redis.from_url(settings.redis_url, decode_responses=True)
    timeout = 2 if drain else 0
    print(f"[consumer] waiting on {PROCESS_QUEUE} (drain={drain})")
    while True:
        item = rdb.brpop(PROCESS_QUEUE, timeout=timeout)
        if item is None:
            if drain:
                print("[consumer] queue empty, exiting")
                return
            continue
        try:
            job = json.loads(item[1])
            event = process_job(job, rdb=rdb)
            if event is not None:
                publish_activity(
                    rdb, "processed",
                    f"{Path(event.pdf_path).name}: {event.n_chunks} clauses chunked ({event.extraction_method}) → review queue",
                    regulator=event.regulator,
                )
        except Exception as e:  # a bad PDF must not kill the service — or vanish
            print(f"[consumer] job failed: {type(e).__name__}: {e}")
            try:
                dead = json.loads(item[1])
                dead["_error"] = f"{type(e).__name__}: {e}"
                rdb.lpush(DEAD_LETTER_QUEUE, json.dumps(dead))
                publish_activity(rdb, "failed", f"processing failed → dead-letter: {type(e).__name__}: {e}",
                                 regulator=dead.get("regulator", ""))
            except Exception:
                rdb.lpush(DEAD_LETTER_QUEUE, item[1])


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--drain", action="store_true", help="process backlog then exit")
    args = parser.parse_args()
    run(drain=args.drain)
