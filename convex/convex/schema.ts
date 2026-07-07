// Convex schema — replaces the custom vector DB (Qdrant) and the Redis state
// machine with real-time tables, built-in vector search, and workflow state.
//
// Deploy:  cd convex && npm i && npx convex dev
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // ---- Regulatory rulebook + built-in vector search (replaces Qdrant) ----
  clauses: defineTable({
    clauseId: v.string(), // stable citation id e.g. "AMFI-COC-2022/4.g"
    docId: v.string(),
    regulator: v.string(),
    clauseNumber: v.string(),
    text: v.string(),
    tags: v.array(v.string()),
    mandatory: v.boolean(),
    status: v.string(), // ACTIVE | SUPERSEDED | AMENDED — temporal hard-filter
    sourcePage: v.optional(v.number()),
    sourceUrl: v.string(),
    embedding: v.array(v.float64()),
  })
    .index("by_clause_id", ["clauseId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      // Filter fields let retrieval pre-filter audience + status INSIDE the
      // vector search — zero cross-regulator contamination, dead clauses excluded.
      filterFields: ["status", "regulator", "tags"],
    }),

  // ---- Reviews + findings (real-time synced to the client) ----
  reviews: defineTable({
    orgId: v.string(),
    channel: v.string(),
    audience: v.string(),
    language: v.string(),
    content: v.string(),
    contentSha256: v.string(),
    verdict: v.string(), // pass | needs_changes | fail | error | pending
    rewrite: v.optional(v.string()),
    summary: v.string(),
    createdAt: v.number(),
  }).index("by_org", ["orgId", "createdAt"]),

  findings: defineTable({
    reviewId: v.id("reviews"),
    source: v.string(),
    severity: v.string(),
    clauseId: v.optional(v.string()),
    clauseQuote: v.string(),
    offendingText: v.string(),
    explanation: v.string(),
    issueKey: v.string(),
    regulator: v.string(),
    sourcePage: v.optional(v.number()),
    sourceUrl: v.string(),
    docStatus: v.string(),
  }).index("by_review", ["reviewId"]),

  // ---- Multi-agent workflow state (replaces the Redis state machine) ----
  // The frontend subscribes here to watch reviewer→adjudicator→rewriter live.
  agentRuns: defineTable({
    reviewId: v.string(),
    step: v.string(), // deterministic | retrieval | reviewer | adjudicator | rewriter | verdict
    status: v.string(), // running | done | error
    detail: v.string(),
    provider: v.string(), // hermes | openai
    at: v.number(),
  }).index("by_review", ["reviewId", "at"]),

  // ---- Living knowledge base change feed (from Linkup / ingestion) ----
  corpusChanges: defineTable({
    regulator: v.string(),
    title: v.string(),
    url: v.string(),
    source: v.string(), // linkup | fleet
    status: v.string(), // pending_review | merged | ignored
    at: v.number(),
  }).index("by_time", ["at"]),
});
