"""Linkup real-time regulatory search — the live knowledge-base layer.

Exposed as a Hermes function: mid-review, the agent can call `linkup_search`
to pull the very latest SEBI/RBI/AMFI/IRDAI circular on a topic, instead of
relying only on the ingested corpus. This replaces the standing scraper fleet
for the "is there anything newer?" question.
"""

import json

import httpx

from app.core.config import get_settings

# Function-calling tool definition handed to Hermes.
LINKUP_TOOL = {
    "type": "function",
    "function": {
        "name": "linkup_search",
        "description": (
            "Search the live web for the latest Indian financial-regulatory "
            "circulars, notifications or rules (SEBI, RBI, AMFI, IRDAI). Use when "
            "you need the most recent regulation on a topic that may post-date the "
            "ingested rulebook."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Natural-language regulatory query, e.g. 'latest SEBI advertisement code for research analysts 2026'"},
                "regulator": {"type": "string", "enum": ["SEBI", "RBI", "AMFI", "IRDAI", "any"]},
            },
            "required": ["query"],
        },
    },
}


def available() -> bool:
    return bool(get_settings().linkup_api_key)


async def search(query: str, regulator: str = "any", depth: str = "standard") -> dict:
    """Call Linkup and return a sourced answer + results."""
    settings = get_settings()
    if not settings.linkup_api_key:
        raise RuntimeError("LINKUP_API_KEY not configured")

    scoped = query if regulator == "any" else f"{regulator} {query} site:gov.in OR official circular"
    async with httpx.AsyncClient(timeout=45) as client:
        resp = await client.post(
            f"{settings.linkup_base_url}/search",
            headers={"Authorization": f"Bearer {settings.linkup_api_key}", "Content-Type": "application/json"},
            json={
                "q": scoped,
                "depth": depth,
                "outputType": "sourcedAnswer",
                "includeImages": False,
            },
        )
        resp.raise_for_status()
        return resp.json()


async def linkup_tool_impl(args: dict) -> str:
    """Adapter the Hermes function-calling loop invokes. Returns a compact
    string result the model can reason over."""
    if not available():
        return json.dumps({"error": "Linkup not configured — rely on the ingested corpus."})
    try:
        data = await search(args["query"], args.get("regulator", "any"))
    except Exception as e:
        return json.dumps({"error": f"{type(e).__name__}: {e}"})
    answer = data.get("answer", "")
    sources = [
        {"name": s.get("name"), "url": s.get("url")}
        for s in (data.get("sources") or [])[:5]
    ]
    return json.dumps({"answer": answer, "sources": sources})


async def find_latest(query: str, regulator: str = "any") -> dict:
    """Direct helper for the dashboard's 'check for newer circulars' button."""
    data = await search(query, regulator, depth="deep")
    return {
        "answer": data.get("answer", ""),
        "sources": [{"name": s.get("name"), "url": s.get("url")} for s in (data.get("sources") or [])[:8]],
    }
