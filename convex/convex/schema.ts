// ============================================================================
//  Mudra.ai — Unified Convex schema (Phase 1)
//  Convex is the SOLE backend and vector store. No Qdrant, no split-brain.
//  Built-in vector search lives on `regulatoryCorpus`; every other table is
//  subscribed to reactively by the War Room UI.
// ============================================================================
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// ---- shared unions ---------------------------------------------------------
export const CORPUS_STATUS = v.union(v.literal("ACTIVE"), v.literal("SUPERSEDED"), v.literal("AMENDED"));
export const SESSION_STATUS = v.union(
  v.literal("QUEUED"),
  v.literal("EMBEDDING"),
  v.literal("RETRIEVING"),
  v.literal("ADJUDICATING"),
  v.literal("VOICE_STREAMING"),
  v.literal("REMEDIATING"),
  v.literal("COMPLETED"),
  v.literal("ERROR"),
);
export const AGENT_NODE = v.union(
  v.literal("Embedder"),
  v.literal("Retriever"),
  v.literal("Adjudicator"),
  v.literal("Remediator"),
  v.literal("VoiceOfficer"),
  // advanced autonomous patterns
  v.literal("Detective"), // pre-retrieval query expansion
  v.literal("Marketer"), // Red-Team Agent A
  v.literal("SEBIOfficer"), // Red-Team Agent B
  v.literal("Director"), // emotional-steerage director
);
export const CRITICALITY = v.union(v.literal("critical"), v.literal("major"), v.literal("minor"));
export const VOICE_EMOTION = v.union(v.literal("casual"), v.literal("stern"), v.literal("urgent"));

export default defineSchema({
  // --- semantically-chunked rulebook + built-in vector search --------------
  regulatoryCorpus: defineTable({
    regulator: v.string(), // SEBI | AMFI | RBI | IRDAI
    clauseId: v.string(), // stable citation id, e.g. "AMFI-COC-2022/4.g"
    rawText: v.string(), // verbatim extracted text
    cleanMarkdown: v.string(), // layout-aware markdown (tables preserved)
    embedding: v.array(v.float64()),
    validFrom: v.string(), // ISO date
    validTo: v.optional(v.string()),
    status: CORPUS_STATUS, // retrieval hard-filters status == ACTIVE
    sourcePdfUrl: v.string(),
  })
    .index("by_clause_id", ["clauseId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      // status is a filterField so `ctx.vectorSearch(... filter status=ACTIVE)`
      // runs inside the traversal — superseded rules never surface.
      filterFields: ["status", "regulator"],
    }),

  // --- one live interrogation; the UI binds to a single row ---------------
  complianceSessions: defineTable({
    userId: v.string(),
    rawInputDraft: v.string(),
    sessionStatus: SESSION_STATUS,
    remediatedText: v.optional(v.string()),
    riskScore: v.number(), // 0-100, drives the ₹546 Cr Risk Radar
    auditTrailPdfId: v.optional(v.id("_storage")),
    // Director-agent emotional-steerage output (voice copilot).
    voiceClipId: v.optional(v.id("_storage")),
    voiceEmotion: v.optional(VOICE_EMOTION),
  }).index("by_user", ["userId"]),

  // --- streaming agent thoughts for the Agent Execution Grid --------------
  agentMonologue: defineTable({
    sessionId: v.id("complianceSessions"),
    activeNode: AGENT_NODE,
    thoughtDetails: v.string(),
    timestamp: v.number(),
  }).index("by_session", ["sessionId", "timestamp"]),

  // --- structured Adjudicator flags, each linked to a corpus vector doc ---
  violations: defineTable({
    sessionId: v.id("complianceSessions"),
    corpusId: v.id("regulatoryCorpus"),
    targetPhrase: v.string(), // verbatim offending span (drives highlight/strikethrough)
    criticality: CRITICALITY,
    explanation: v.string(),
    suggestedFix: v.string(),
  }).index("by_session", ["sessionId"]),
});
