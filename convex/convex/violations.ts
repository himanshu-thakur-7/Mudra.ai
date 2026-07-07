// Reactive violations + the batch insert the pipeline calls.
import { v } from "convex/values";
import { query, internalMutation, internalQuery } from "./_generated/server";
import { CRITICALITY } from "./schema";

export const getViolations = query({
  args: { sessionId: v.id("complianceSessions") },
  handler: (ctx, { sessionId }) =>
    ctx.db
      .query("violations")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect(),
});

// Loads a violation plus the verbatim clause it cites — the "retrieved context"
// the Red-Team debate and the Director agent reason over.
export const getContext = internalQuery({
  args: { violationId: v.id("violations") },
  handler: async (ctx, { violationId }) => {
    const violation = await ctx.db.get(violationId);
    if (!violation) return null;
    const clause = await ctx.db.get(violation.corpusId);
    return {
      sessionId: violation.sessionId,
      targetPhrase: violation.targetPhrase,
      criticality: violation.criticality,
      explanation: violation.explanation,
      suggestedFix: violation.suggestedFix,
      clauseId: clause?.clauseId ?? "",
      clauseText: clause?.cleanMarkdown || clause?.rawText || "",
      regulator: clause?.regulator ?? "",
    };
  },
});

// The Red-Team debate writes its winning compliant rewrite back onto the flag.
export const applyDebateOutcome = internalMutation({
  args: { violationId: v.id("violations"), suggestedFix: v.string() },
  handler: async (ctx, { violationId, suggestedFix }) => {
    await ctx.db.patch(violationId, { suggestedFix });
  },
});

export const batchInsert = internalMutation({
  args: {
    sessionId: v.id("complianceSessions"),
    rows: v.array(
      v.object({
        corpusId: v.id("regulatoryCorpus"),
        targetPhrase: v.string(),
        criticality: CRITICALITY,
        explanation: v.string(),
        suggestedFix: v.string(),
      }),
    ),
  },
  handler: async (ctx, { sessionId, rows }) => {
    for (const r of rows) await ctx.db.insert("violations", { sessionId, ...r });
  },
});
