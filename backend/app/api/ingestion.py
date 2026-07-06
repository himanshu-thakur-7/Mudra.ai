"""Ingestion dashboard API: live fleet state from Redis + object store + DB,
and a trigger to run one sweep (fleet binary → consumer drain) from the UI."""

import json
import subprocess
import sys
import threading
from pathlib import Path

import redis as redis_lib
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.config import REPO_DIR, get_settings
from app.core.db import get_db
from app.models import CorpusChangeEvent, User

router = APIRouter(prefix="/ingestion", tags=["ingestion"])

INGESTION_DIR = REPO_DIR / "ingestion"
INBOX_DIR = REPO_DIR / "corpus" / "inbox"
SWEEP_LOCK = "ingest:sweep:running"
REGULATORS = ["SEBI", "AMFI", "RBI", "IRDAI"]


def _redis():
    return redis_lib.Redis.from_url(get_settings().redis_url, decode_responses=True)


@router.get("/status")
def status(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    try:
        rdb = _redis()
        rdb.ping()
    except Exception:
        return {"redis": False}

    targets = []
    targets_file = INGESTION_DIR / "targets.json"
    if targets_file.exists():
        cfg = json.loads(targets_file.read_text())
        for t in cfg.get("targets", []):
            targets.append({
                "regulator": t["regulator"],
                "name": t["name"],
                "url": t["url"],
                "seen": rdb.scard(f"ingest:seen:{t['regulator']}"),
            })

    inbox = []
    if INBOX_DIR.exists():
        files = sorted(INBOX_DIR.glob("*/*.pdf"), key=lambda p: p.stat().st_mtime, reverse=True)
        for p in files[:10]:
            inbox.append({
                "file": p.name,
                "regulator": p.parent.name.upper(),
                "kb": p.stat().st_size // 1024,
            })
        total_docs = len(files)
    else:
        total_docs = 0

    activity = [json.loads(x) for x in rdb.lrange("ingest:activity", 0, 99)]

    # Ingestion state machine: DISCOVERED -> DOWNLOADED -> PARSED -> CHUNKED -> …
    doc_states: dict[str, int] = {}
    try:
        for raw in rdb.hvals("ingest:docstate"):
            state = json.loads(raw).get("state", "?")
            doc_states[state] = doc_states.get(state, 0) + 1
    except Exception:
        pass

    changes = db.scalars(
        select(CorpusChangeEvent).order_by(CorpusChangeEvent.created_at.desc()).limit(6)
    ).all()

    return {
        "redis": True,
        "sweep_running": bool(rdb.exists(SWEEP_LOCK)),
        "queues": {
            "download": rdb.llen("ingest:download"),
            "process": rdb.llen("ingest:process"),
            "failed": rdb.llen("ingest:process:failed"),
        },
        "targets": targets,
        "inbox": inbox,
        "total_docs": total_docs,
        "total_change_events": db.scalar(select(func.count(CorpusChangeEvent.id))) or 0,
        "doc_states": doc_states,
        "recent_changes": [
            {"regulator": c.regulator, "n_chunks": c.n_chunks, "method": c.extraction_method,
             "status": c.status, "created_at": c.created_at.isoformat(),
             "supersession_hints": len(c.supersession_hints or [])}
            for c in changes
        ],
        "activity": activity,
    }


def _run_sweep_then_drain() -> None:
    rdb = _redis()
    try:
        fleet_bin = INGESTION_DIR / "bin" / "fleet"
        if fleet_bin.exists():
            cmd = [str(fleet_bin), "-config", "targets.json", "sweep"]
        else:
            cmd = ["go", "run", "./cmd/fleet", "-config", "targets.json", "sweep"]
        subprocess.run(cmd, cwd=INGESTION_DIR, timeout=1800, capture_output=True)
        subprocess.run(
            [sys.executable, "-m", "app.workers.consumer", "--drain"],
            cwd=REPO_DIR / "backend", timeout=1800, capture_output=True,
        )
    finally:
        rdb.delete(SWEEP_LOCK)


@router.post("/sweep")
def trigger_sweep(user: User = Depends(get_current_user)):
    rdb = _redis()
    # NX lock with TTL: one sweep at a time; TTL covers a crashed runner.
    if not rdb.set(SWEEP_LOCK, "1", nx=True, ex=3600):
        raise HTTPException(status_code=409, detail="A sweep is already running")
    threading.Thread(target=_run_sweep_then_drain, daemon=True).start()
    return {"started": True}
