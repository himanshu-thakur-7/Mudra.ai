# Mudra.ai — Live Compliance War Room

A high-performance pre-review layer and risk-mitigation platform for Indian
financial distributors (MFDs, RIAs, NBFCs, insurers). Instead of text-in/text-out
RAG, Mudra.ai is a **live multi-agent interrogation**: agents debate your draft
in real time, every violation is priced in rupees on a Risk Radar, each flagged
clause is read aloud, and the non-compliant text is struck through and rewritten
before your eyes.

## Partner-native architecture

```
Astro (SSR) + Aceternity islands  ──subscribe──►  Convex (reactive, WebSockets)
        │  (War Room · Risk Radar · Strikethrough)        │  single source of truth
        │                                                  │
        └── start(session) ──► Convex action: interrogate.run ──────────────┐
                                        │                                    │
     Reviewer ─(tool)─► Linkup live search ─► upsert into Convex vector store │
        │                                                                    │
        ▼                                                                    ▼
     Adjudicator (Nous Hermes, strict JSON) ─► violations table ─► Risk Radar
        │                                                                    │
        ▼                                                                    ▼
     Remediator (Hermes rewrite) ──► session.rewrittenText   ElevenLabs ─► voice clips
```

Every arrow that touches Convex is a reactive mutation — the UI re-renders the
instant it lands, no polling. All model calls route through the **Cloudflare AI
Gateway** for latency/cache/token observability. **Razorpay** UPI AutoPay powers
the ₹2–5k/mo self-serve tier. **OpenAI GPT-5.5** does vision/OCR on unstructured
regulator PDFs before the refined context reaches Hermes.

## File layout

```
convex/convex/
  schema.ts          # Phase 1 — regulatoryCorpus (temporal + vectorIndex),
                     #   complianceSessions, agentMonologue, violations
  prompts.ts         # Phase 2 — Adjudicator system prompt + strict violations JSON schema
  hermes.ts          # Nous Hermes client (structured / tools / embeddings) via CF AI Gateway
  linkup.ts          # Phase 2 — search_live_regulations tool + Linkup→Convex upsert
  corpus.ts          # filtered vector search + idempotent upsert
  interrogate.ts     # Phase 3 — THE THEATER ENGINE (multi-agent orchestration + reactive push)
  sessions.ts / monologue.ts / violations.ts   # reactive queries + streaming mutations
  elevenlabs.ts      # low-latency TTS → Convex file storage → session

web/src/
  components/mudra/
    MudraConsole.tsx        # container: live-on-Convex, or scripted demo mode
    WarRoomCanvas.tsx       # Phase 4 — multi-agent node graph + streaming monologue
    RiskRadar.tsx           # Phase 4 — ₹546 Cr radial gauge (green→glowing red)
    StrikethroughEditor.tsx # Phase 4 — live cross-out + fade-in rewrite
  pages/mudra.astro         # the War Room page
  lib/convex.ts             # Convex client + UI types
```

## Run

```bash
# Convex (reactive backend)
cd convex && npm install && npx convex dev      # provisions deployment, prints CONVEX_URL
#   set the partner keys once:
npx convex env set HERMES_API_KEY ...   OPENAI_API_KEY ...   LINKUP_API_KEY ...
npx convex env set ELEVENLABS_API_KEY ...   CF_AI_GATEWAY_BASE ...
#   load the rulebook into Convex vector storage (from the Python corpus):
cd ../backend && uv run python -m app.services.corpus.ingest sync-convex

# Frontend
cd ../web && echo "PUBLIC_CONVEX_URL=<your url>" >> .env && npm install && npm run dev
```

Without `PUBLIC_CONVEX_URL` the War Room runs in **DEMO MODE** — a scripted
interrogation drives the exact same components (with browser voice), so the
theater is fully viewable before Convex is provisioned.

## The four phases (as requested)

1. **Convex reactive schema** — `convex/convex/schema.ts`
2. **Hermes Adjudicator prompt + `search_live_regulations` + Linkup executor** — `prompts.ts`, `linkup.ts`
3. **Theater engine** — `convex/convex/interrogate.ts` (agents + ElevenLabs + reactive push)
4. **Aceternity UI** — War Room canvas, Risk Radar, Strikethrough editor
