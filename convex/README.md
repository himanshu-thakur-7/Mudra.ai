# Convex backend

Real-time DB, built-in vector search (replaces Qdrant), and multi-agent
workflow state (replaces the Redis state machine).

```bash
cd convex
npm install
npx convex dev        # logs in, provisions a deployment, prints CONVEX_URL
```

Set `CONVEX_URL` and `CONVEX_DEPLOY_KEY` in `backend/.env`. The FastAPI
orchestrator then mirrors each agent step to `agents:pushStep`, and the Astro
frontend subscribes to `agents:watch` to render the pipeline live.

- `schema.ts` — clauses (with `vectorIndex` + `status`/`regulator`/`tags`
  filter fields), reviews, findings, `agentRuns` (realtime workflow), corpusChanges.
- `agents.ts` — `pushStep` mutation + `watch` query (live pipeline).
- `clauses.ts` — `upsert` mutation + `search` action (filtered vector search).

Load the rulebook into Convex from the Python side:
`uv run python -m app.services.corpus.ingest sync-convex`.
