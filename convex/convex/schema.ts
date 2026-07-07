// ============================================================================
//  Mudra.ai — Convex reactive schema (single source of truth for the UI)
//  Every table here is subscribed to by the frontend; a mutation from the
//  interrogation pipeline instantly re-renders the War Room, Risk Radar and
//  the live Strikethrough editor over WebSockets. No polling anywhere.
// ============================================================================
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// ---- shared literal unions (kept in one place, imported by functions) ------
export const SESSION_STATUS = v.union(
  v.literal("QUEUED"),
  v.literal("PARSING"),
  v.literal("REVIEWING"),
  v.literal("SEARCHING_LIVE"),
  v.literal("ADJUDICATING"),
  v.literal("REMEDIATING"),
  v.literal("VOICE_STREAMING"),
  v.literal("COMPLETED"),
  v.literal("ERROR"),
);

export const AGENT_NODE = v.union(
  v.literal("Reviewer"),
  v.literal("LinkupSearch"),
  v.literal("Adjudicator"),
  v.literal("Remediator"),
  v.literal("VoiceOfficer"),
);

export const CORPUS_STATE = v.union(
  v.literal("ACTIVE"),
  v.literal("SUPERSEDED"),
  v.literal("AMENDED"),
);

export const SEVERITY = v.union(
  v.literal("critical"),
  v.literal("major"),
  v.literal("minor"),
);

export default defineSchema({
  // --------------------------------------------------------------------------
  //  regulatoryCorpus — semantically chunked rules with temporal validity,
  //  deep citation metadata and built-in vector search (replaces Qdrant).
  // --------------------------------------------------------------------------
  regulatoryCorpus: defineTable({
    clauseId: v.string(), // stable citation id, e.g. "AMFI-COC-2022/4.g"
    regulator: v.string(), // SEBI | AMFI | RBI | IRDAI
    docTitle: v.string(),
    clauseNumber: v.string(),
    text: v.string(), // verbatim clause (the quote a compliance officer signs under)
    tags: v.array(v.string()), // e.g. ["audience:mfd","assured-returns"]
    audience: v.string(), // mfd | ia-ra | nbfc-lsp | insurance
    mandatory: v.boolean(),

    // temporal — "git for laws". Retrieval hard-filters state == ACTIVE.
    state: CORPUS_STATE,
    validFrom: v.string(), // ISO date
    validTo: v.optional(v.string()),
    supersededBy: v.optional(v.string()),

    // deep citation lineage (Reg 16C: every flag must be defensible)
    sourceUrl: v.string(),
    sourcePage: v.optional(v.number()),
    rawPdfKey: v.optional(v.string()), // Convex storage id of the cached PDF
    ingestedFrom: v.string(), // "seed" | "linkup" | "fleet"
    contentHash: v.string(), // dedupe key for idempotent upserts

    embedding: v.array(v.float64()),
  })
    .index("by_clause_id", ["clauseId"])
    .index("by_hash", ["contentHash"])
    .index("by_audience_state", ["audience", "state"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      // Filters run INSIDE the vector traversal → audience + ACTIVE pre-filter
      // with no added latency, zero cross-regulator / dead-clause contamination.
      filterFields: ["state", "audience", "regulator"],
    }),

  // --------------------------------------------------------------------------
  //  complianceSessions — one live interrogation. The UI binds directly to a
  //  single row; status drives the whole theater.
  // --------------------------------------------------------------------------
  complianceSessions: defineTable({
    orgId: v.string(),
    audience: v.string(),
    channel: v.string(), // whatsapp | social | email | web
    draft: v.string(), // raw user input
    draftSentences: v.array(v.string()), // sentence-split, so the editor can target spans

    status: SESSION_STATUS,
    verdict: v.optional(
      v.union(v.literal("pass"), v.literal("needs_changes"), v.literal("fail"), v.literal("error")),
    ),
    rewrittenText: v.optional(v.string()), // final Remediator output
    summary: v.optional(v.string()),

    // theater / voice
    riskScore: v.number(), // 0-100 live financial-exposure score (Risk Radar)
    exposureInr: v.number(), // ₹ exposure estimate driving the radar
    voiceClipKeys: v.array(v.string()), // ordered Convex storage ids of ElevenLabs segments
    activeAgent: v.optional(AGENT_NODE), // currently-lit node in the War Room

    provider: v.string(), // hermes | openai (whichever served this run)
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  }).index("by_org", ["orgId", "createdAt"]),

  // --------------------------------------------------------------------------
  //  agentMonologue — streaming logs for the Multi-Agent War Room Canvas.
  //  Each row is one "thought" from one agent node, appended live.
  // --------------------------------------------------------------------------
  agentMonologue: defineTable({
    sessionId: v.id("complianceSessions"),
    agent: AGENT_NODE,
    status: v.union(v.literal("thinking"), v.literal("done"), v.literal("error")),
    message: v.string(), // human-readable thought shown in the canvas
    tokensPerSec: v.optional(v.number()), // for the "oomph" throughput ticker
    at: v.number(),
  }).index("by_session", ["sessionId", "at"]),

  // --------------------------------------------------------------------------
  //  violations — structured Adjudicator output, each linked to the exact
  //  regulatoryCorpus vector document it cites.
  // --------------------------------------------------------------------------
  violations: defineTable({
    sessionId: v.id("complianceSessions"),
    corpusId: v.optional(v.id("regulatoryCorpus")), // the cited vector doc
    clauseId: v.string(), // denormalised for display + validation
    severity: SEVERITY,
    category: v.string(), // grouping key e.g. "assured_returns"
    offendingText: v.string(), // verbatim span from the draft (drives strikethrough)
    sentenceIndex: v.optional(v.number()), // which draftSentence to strike
    rationale: v.string(), // why it violates — read aloud by the Voice Officer
    suggestedFix: v.string(),
    // financial-exposure weighting for the Risk Radar
    exposureWeight: v.number(), // ₹ this violation contributes to the gauge
    confidence: v.number(), // 0..1 from the Adjudicator
    adjudication: v.union(v.literal("upheld"), v.literal("downgraded")),
    at: v.number(),
  }).index("by_session", ["sessionId", "at"]),
});
