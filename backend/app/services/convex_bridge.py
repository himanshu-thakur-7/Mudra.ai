"""Bridge from the FastAPI orchestrator to Convex.

Mirrors each agent step into Convex's `agentRuns` table so the Astro frontend
can subscribe and render the reviewer→adjudicator→rewriter pipeline advancing
in real time. Best-effort: when CONVEX_URL isn't set, every call is a no-op, so
the pipeline runs identically with or without Convex.
"""

import time

import httpx

from app.core.config import get_settings


def available() -> bool:
    return bool(get_settings().convex_url)


async def push_step(review_id: str, step: str, status: str, detail: str = "", provider: str = "") -> None:
    settings = get_settings()
    if not settings.convex_url:
        return
    headers = {"Content-Type": "application/json"}
    if settings.convex_deploy_key:
        headers["Authorization"] = f"Convex {settings.convex_deploy_key}"
    payload = {
        "path": "agents:pushStep",
        "args": {
            "reviewId": review_id, "step": step, "status": status,
            "detail": detail, "provider": provider or settings.agent_provider,
            "at": int(time.time() * 1000),
        },
        "format": "json",
    }
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            await client.post(f"{settings.convex_url.rstrip('/')}/api/mutation", json=payload, headers=headers)
    except Exception:
        pass  # realtime mirroring must never break the review
