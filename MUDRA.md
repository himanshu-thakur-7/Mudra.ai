# Mudra.ai — Live Compliance War Room

A pre-review layer and risk-mitigation platform for Indian financial
distributors (MFDs, RIAs, NBFCs, insurers). **Convex is the sole backend and
vector store** — there is no local Qdrant, no duplicated Python agent pipeline.
Agents debate your draft live inside Convex; violations are priced in rupees on
a Risk Radar; non-compliant text is struck through and rewritten in real time.

## Architecture (no split-brain)

```
Astro (React islands, Aceternity)  ──useQuery (WebSockets)──►  Convex
  ComplianceWarRoom                                              (SOLE backend
   ├─ ₹546 Cr Risk Radar   ◄── session.riskScore                 + vector store)
   ├─ Agent Execution Grid ◄── agentMonologue (streamed)
   └─ Text Canvas + Voice  ◄── session.sessionStatus / violations
        │
        └─ sessions.start ─► schedules ─► hermes.runCompliancePipeline (action)
                 1. embed draft (OpenAI)                       │ appendThought ×N
                 2. ctx.vectorSearch(regulatoryCorpus, ACTIVE) │  → agentMonologue
                 3. Nous Hermes 3 via Cloudflare AI Gateway    │
                    (response_format json_object)              │
                 4. batch-insert violations ─► Risk Radar
                 5. Remediator rewrite ─► session.remediatedText

Python ingestion worker (PyMuPDF)  ──HTTP POST──►  Convex /api/actions/corpus/bulkIngest
  extract_chunks(): text blocks → markdown tables → clause-grouped chunks
```

Python does **only** PDF parsing + push. All orchestration, vector search and
reactive state live in Convex.

## File layout

```
convex/convex/
  schema.ts        # Phase 1 — regulatoryCorpus (vectorIndex), complianceSessions,
                   #   agentMonologue, violations  (exact field names)
  hermes.ts        # Phase 2 — appendThought mutation + runCompliancePipeline action
                   #   (embed → vectorSearch ACTIVE → Hermes 3 json_object → violations)
  sessions.ts      # start (schedules pipeline) + getSession + status/risk mutations
  monologue.ts     # getMonologue (reactive stream)
  violations.ts    # getViolations + batchInsert
  corpus.ts        # hydrate (vector hits), upsert, bulkIngest action
  http.ts          # POST /api/actions/corpus/bulkIngest  (Python → Convex)

backend/app/services/corpus/
  chunker.py       # Phase 3 — PyMuPDF layout-aware extract_chunks() +
                   #   markdown-table detection + clause-break grouping + push_to_convex()

web/src/
  components/ComplianceWarRoom.tsx   # Phase 4 — Risk Radar + Agent Grid + Text Canvas
  components/MudraLauncher.tsx        # starts a session; live-Convex or scripted demo
  pages/mudra.astro
  lib/convex.ts                       # ConvexReactClient + anyApi
```

Deleted in this remediation: `backend/app/services/retrieval/` (Qdrant),
`.qdrant/`, `backend/app/services/agents/` and `review_service.py` (the Python
orchestration split-brain).

## Run

```bash
# 1. Convex — the whole backend
cd convex && npm install && npx convex dev          # provisions deployment, prints CONVEX_URL
npx convex env set OPENAI_API_KEY ...   HERMES_API_KEY ...   HERMES_MODEL Hermes-3-Llama-3.1-405B
npx convex env set CF_AI_GATEWAY_BASE ...            # optional, for observability

# 2. Ingest a PDF (Python worker → Convex)
cd ../backend && uv sync
uv run python -m app.services.corpus.chunker corpus/sources/sebi-adcode-2023.pdf \
  --regulator SEBI --doc-id SEBI-ADCODE-2023          # add CONVEX_SITE_URL to push

# 3. Frontend
cd ../web && echo "PUBLIC_CONVEX_URL=<your url>" >> .env && npm install && npm run dev
```

Without `PUBLIC_CONVEX_URL` the War Room runs a scripted demo (same components,
browser voice) so it's viewable before Convex is provisioned.
```
