# ComplianceCopilot — AI Compliance Officer for Indian Financial Services

Pre-review co-pilot that checks financial marketing content (WhatsApp posts,
social captions, ad copy) against SEBI, AMFI, RBI and IRDAI rules — with every
flag cited to a verbatim regulatory clause, a compliant rewrite, and a
downloadable audit-trail PDF.

Four audiences are live: **MFD** (SEBI/AMFI), **IA/RA** (SEBI Ad Code 2023),
**Digital lender / LSP** (RBI Digital Lending Directions 2025), **Insurer /
agent** (IRDAI Advertisement Regulations 2021). English + Hindi UI; rewrites
stay in the original language (incl. Hinglish).

**Positioning (by design):** a pre-review layer with the human compliance officer
in the loop — never a replacement. SEBI's Intermediaries (Amendment) Regulations
2025 (Reg 16C) keep the regulated entity solely liable for AI outputs; the audit
trail + explainability is the product's answer to that.

## How it works

```
content ─► deterministic checks (ARN / tagline / risk-warning / prohibited claims)
        ─► clause retrieval (audience-filtered embeddings + mandatory clause union)
        ─► reviewer agent ─► adjudicator agent ─► clause-ID validation
        ─► rewriter agent ─► verdict + audit PDF
```

- **Clause registry** (`corpus/processed/clauses.json`): 42 human-reviewed,
  verbatim clauses from 4 primary sources (SEBI Ad Code 2023, AMFI Code of
  Conduct 2022, AMFI Do's & Don'ts FAQ, AMFI Master Circular 2026). A finding
  can only cite an ID that exists here — hallucinated citations are stripped
  server-side and logged in the audit trail.
- **Multi-agent review**: the adjudicator independently re-verifies every
  reviewer flag against the verbatim clause text and drops what wouldn't
  survive a human compliance officer's scrutiny.
- **Audit trail**: every pipeline stage journaled per review; one-click PDF
  with content hash, findings + clause quotes, and a reviewer sign-off line.

## Run it

Backend (Python 3.12, [uv](https://docs.astral.sh/uv/)):

```bash
cd backend
cp .env.example .env          # add your OPENAI_API_KEY
uv sync
uv run python -m app.services.corpus.ingest load   # load clause registry + embeddings
uv run uvicorn app.main:app --port 8000
```

Frontend (Node 20+):

```bash
cd frontend
npm install
npm run dev                   # http://localhost:5173 (proxies /api to :8000)
```

## Tests

```bash
cd backend
uv run pytest                 # deterministic + mocked-pipeline tests (fast, no API key)
RUN_LLM_TESTS=1 uv run pytest # + live LLM golden tests
```

## WhatsApp (Twilio sandbox)

1. Expose the backend: `ngrok http 8000`
2. In the Twilio console → WhatsApp sandbox, set "When a message comes in" to
   `POST https://<your-ngrok>/webhooks/whatsapp`
3. Send any marketing text to the sandbox number — you get verdict, top issues
   with clause citations, the compliant rewrite, and a link to the full report.

## Living knowledge base (distributed ingestion engine)

The Go fleet watches regulator listing pages, detects changes by normalized
DOM hash, and downloads new circulars under a fleet-wide per-domain token
bucket (Redis). PDFs land in `corpus/inbox/` (the object-store seam) and a
ProcessJob goes on the Redis broker; the Python consumer cascade-extracts
(pdfplumber → tesseract OCR), chunks by **legal structure** with forced
provenance metadata, and files a change event for human review.

```bash
redis-server --port 6379 --dir .redis --save '' --appendonly no &   # broker + limiter + snapshots
cd ingestion && go run ./cmd/fleet -config targets.json sweep       # one pass (or: watch)
cd backend && uv run python -m app.workers.consumer --drain        # process the backlog
# review drafts in corpus/processed/drafts/, merge vetted clauses into clauses.json, then:
uv run python -m app.services.corpus.ingest load
```

Change feed: `GET /api/corpus/changes`. Production swaps: Redis list → RabbitMQ
(queue interface), local inbox → S3, embedded Qdrant → Qdrant server.

### Retrieval backends

`RETRIEVAL_BACKEND=sqlite` (default, numpy cosine) or `qdrant` (embedded local
mode, audience payload filtering — zero cross-regulator contamination inside
the vector engine). `uv run python -m app.services.corpus.ingest sync-qdrant`
rebuilds the collection.

## Corpus maintenance

Add a new regulatory document:

```bash
uv run python -m app.services.corpus.ingest extract <pdf> --regulator SEBI --doc-id MY-DOC-ID
# review the draft JSON, merge into corpus/processed/clauses.json, then:
uv run python -m app.services.corpus.ingest load
```

The draft → human review → commit flow is deliberate: **corpus accuracy is the
product.** Never encode a rule without a primary-source clause behind it.

Stage-2/3 target architecture (Go scraper fleet, change detection, vector DB):
see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
