// Structured Adjudicator output, streamed to the UI (Risk Radar + strikethroughs).
import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";
import { SEVERITY } from "./schema";

export const forSession = query({
  args: { sessionId: v.id("complianceSessions") },
  handler: (ctx, { sessionId }) =>
    ctx.db
      .query("violations")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect(),
});

export const add = internalMutation({
  args: {
    sessionId: v.id("complianceSessions"),
    corpusId: v.optional(v.id("regulatoryCorpus")),
    clauseId: v.string(),
    severity: SEVERITY,
    category: v.string(),
    offendingText: v.string(),
    sentenceIndex: v.optional(v.number()),
    rationale: v.string(),
    suggestedFix: v.string(),
    exposureWeight: v.number(),
    confidence: v.number(),
    adjudication: v.union(v.literal("upheld"), v.literal("downgraded")),
  },
  handler: async (ctx, a) => {
    await ctx.db.insert("violations", { ...a, at: Date.now() });
  },
});
