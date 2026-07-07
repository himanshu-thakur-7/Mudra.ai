// Reactive violations + the batch insert the pipeline calls.
import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";
import { CRITICALITY } from "./schema";

export const getViolations = query({
  args: { sessionId: v.id("complianceSessions") },
  handler: (ctx, { sessionId }) =>
    ctx.db
      .query("violations")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect(),
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
