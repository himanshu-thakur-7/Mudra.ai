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

## Built (Stage 2/3) — ingestion as a distributed system

The chaos of scraping Indian government portals is isolated from the precision
of the compliance agents:

1. **Ingestion fleet (Go — `ingestion/`).** One goroutine watcher per
   regulator listing page (SEBI/AMFI/RBI/IRDAI in `targets.json`). A
   fleet-wide per-domain token bucket lives in Redis (atomic Lua script), so
   aggregate request rate stays capped across any number of workers/hosts.
   Change detection hashes the normalized listing DOM (scripts/styles/nonces
   stripped) — only a changed page triggers link extraction. New documents go
   through an at-least-once handoff (push job → mark seen → commit page hash)
   onto a Redis-list broker (`internal/queue` is the RabbitMQ swap seam);
   PDFs land in `corpus/inbox/` (the S3 seam).
2. **Processing service (Python — `app/workers/consumer.py`).** Cascade
   extraction: pdfplumber for native text; low-density (scanned/outlined)
   documents rendered via PDFKit and OCR'd with tesseract. The legal-structure
   chunker (`services/corpus/chunker.py`) splits by chapter/clause/FAQ/
   sub-item — never by token count, never mid-sentence — and force-tags every
   chunk with regulator, source URL, sha256 and chapter context. Output: draft
   chunk files + a `CorpusChangeEvent` feed (`GET /api/corpus/changes`);
   failed jobs park on a dead-letter queue. Merging vetted clauses into
   `clauses.json` stays human-in-the-loop.
3. **Vector storage.** `RETRIEVAL_BACKEND=qdrant` swaps the numpy store for
   Qdrant (embedded local mode; server URL in production) with audience
   payload filtering inside the engine — an MFD query cannot surface an RBI
   lending clause. Parity-tested against the sqlite backend.
4. **Orchestration.** The agent loop stays a local-first custom Python
   framework: explicit reviewer → adjudicator → rewriter transitions, the
   adjudicator cross-references flags against verbatim clause text, and every
   transition is journaled to the audit trail.

**Verticals:** MFD (SEBI/AMFI), IA/RA (SEBI Ad Code 2023), digital lending
(RBI Digital Lending Directions 2025), insurance (IRDAI Advertisement
Regulations 2021) — each with audience-scoped deterministic checks, clauses
and rewriter requirements. UI ships English + Hindi; rewrites stay in the
original language. Billing seam: plan registry + Razorpay order endpoint
(dormant until keys are configured).

## Frontend

Single fast Vite/React SPA — deliberately **not** micro-frontends. The SMB
buyer (individual MFD) uses one flow (paste → verdict → rewrite → PDF);
micro-frontend seams would add build/runtime complexity with no payoff at this
surface area. Speed comes from route-level code splitting, skeleton states
while the pipeline runs, and staying API-thin. If the Stage-3 enterprise tier
needs to embed the checker inside AMC/NBFC portals, the checker page is already
a self-contained route backed only by the public API — extract it into a
web component / module-federation remote then, not before.
