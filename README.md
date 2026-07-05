# ComplianceCopilot — AI Compliance Officer for Indian Financial Services

Pre-review co-pilot that checks MFD/RIA marketing content (WhatsApp posts, social
captions, ad copy) against the SEBI 2023 Advertisement Code and AMFI Code of
Conduct — with every flag cited to a verbatim regulatory clause, a compliant
rewrite, and a downloadable audit-trail PDF.

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
