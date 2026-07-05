# Architecture

## Current (MVP)

Single FastAPI service + Vite SPA. The review pipeline per submission:

```
content ─► deterministic checks (regex, zero-hallucination)
        ─► retrieval (clause embeddings, audience-tag pre-filter + mandatory union)
        ─► reviewer agent (structured output, clause_id per finding)
        ─► adjudicator agent (re-verifies each flag against verbatim clause text)
        ─► server-side clause_id validation (hallucinated citations cannot surface)
        ─► rewriter agent (compliant version)
        ─► audit trail (every stage persisted as AuditEvent) ─► audit PDF
```

Corpus: `corpus/processed/clauses.json` — human-reviewed, clause-level records
(stable ID, regulator, verbatim text, tags, effective date). **Chunking is by
legal structure, never by token count** — a clause is the atomic retrieval unit,
so a finding can always cite one verifiable clause.

## Target (Stage 2/3) — ingestion as a distributed system

The chaos of scraping Indian government portals is isolated from the precision
of the compliance agents:

1. **Ingestion fleet (Go).** Goroutine-based workers monitor circular listing
   pages across SEBI/AMFI/RBI/IRDAI. Distributed rate limiter (token bucket in
   Redis) at the fleet's egress so no regulator domain is hammered. Change
   detection by hashing listing-page DOM state / HTTP headers — only changed
   payloads enqueue a download job (message broker, e.g. RabbitMQ) with the
   PDF landing in object storage.
2. **Processing service (Python).** Cascade extraction: pdfplumber/marker-pdf
   for native text; scanned documents routed to OCR. Custom parsers chunk by
   legal structure (clause / sub-section / annexure). Every chunk is
   force-tagged with metadata before embedding: regulator, effective date,
   master-circular name, source URL.
3. **Vector storage.** Swap the MVP SQLite/numpy `RetrievalStore` adapter for
   Qdrant/Milvus with payload filtering, so an MFD/WhatsApp query pre-filters
   out RBI lending clauses entirely (zero cross-regulator contamination). The
   adapter interface in `app/services/retrieval/` is the only seam to change.
4. **Orchestration.** The agent loop stays a local-first custom Python
   framework (no heavyweight agent library): explicit state transitions
   reviewer → adjudicator → rewriter, with the adjudicator forced to
   cross-reference flags against retrieved clause metadata, and every
   transition journaled to the audit trail.

The MVP's seams map 1:1 onto this: `workers/` (fleet + change detection stubs),
`services/corpus/ingest.py` (extract cascade entry point), `RetrievalStore`
(vector DB adapter), `services/agents/` (orchestration).

## Frontend

Single fast Vite/React SPA — deliberately **not** micro-frontends. The SMB
buyer (individual MFD) uses one flow (paste → verdict → rewrite → PDF);
micro-frontend seams would add build/runtime complexity with no payoff at this
surface area. Speed comes from route-level code splitting, skeleton states
while the pipeline runs, and staying API-thin. If the Stage-3 enterprise tier
needs to embed the checker inside AMC/NBFC portals, the checker page is already
a self-contained route backed only by the public API — extract it into a
web component / module-federation remote then, not before.
