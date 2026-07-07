// Real-time multi-agent workflow state. FastAPI (or a Convex action) writes a
// step as each agent runs; the frontend subscribes to `watch` and renders the
// reviewer→adjudicator→rewriter pipeline advancing live.
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const pushStep = mutation({
  args: {
    reviewId: v.string(),
    step: v.string(),
    status: v.string(),
    detail: v.string(),
    provider: v.string(),
    at: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("agentRuns", args);
  },
});

export const watch = query({
  args: { reviewId: v.string() },
  handler: async (ctx, { reviewId }) => {
    return await ctx.db
      .query("agentRuns")
      .withIndex("by_review", (q) => q.eq("reviewId", reviewId))
      .collect();
  },
});
