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
from datetime import datetime, timezone
from pathlib import Path

import redis
from sqlalchemy import select

from app.core.config import CORPUS_DIR, get_settings
from app.core.db import get_session_factory, init_db
from app.models import CorpusChangeEvent
from app.services.corpus.cascade import extract_text_cascade
from app.services.corpus.chunker import chunk_legal

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


def process_job(job: dict) -> CorpusChangeEvent | None:
    """Idempotent per sha256: re-delivered jobs are no-ops."""
    init_db()
    db = get_session_factory()()
    try:
        existing = db.scalar(
            select(CorpusChangeEvent).where(CorpusChangeEvent.sha256 == job["sha256"])
        )
        if existing:
            return None

        text, method = extract_text_cascade(job["pdf_path"])
        metadata = {
            "regulator": job["regulator"],
            "source_url": job["url"],
            "sha256": job["sha256"],
            "downloaded_at": job.get("downloaded_at", ""),
        }
        chunks = chunk_legal(text, metadata)

        DRAFTS_DIR.mkdir(parents=True, exist_ok=True)
        draft_path = DRAFTS_DIR / f"{job['regulator'].lower()}-{job['sha256'][:8]}.json"
        draft_path.write_text(json.dumps({
            "metadata": metadata,
            "extraction_method": method,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "chunks": [
                {"clause_number": c.clause_number, "kind": c.kind, "text": c.text, "metadata": c.metadata}
                for c in chunks
            ],
        }, indent=2, ensure_ascii=False))

        event = CorpusChangeEvent(
            regulator=job["regulator"], url=job["url"], sha256=job["sha256"],
            pdf_path=job["pdf_path"], draft_path=str(draft_path),
            n_chunks=len(chunks), extraction_method=method,
        )
        db.add(event)
        db.commit()
        print(f"[consumer] {job['regulator']}: {len(chunks)} chunks ({method}) -> {draft_path.name}")
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
            event = process_job(job)
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
