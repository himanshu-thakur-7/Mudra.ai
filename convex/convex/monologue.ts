// Streaming agent thoughts for the War Room Canvas. `stream` is subscribed by
// the frontend; `log` is appended by the interrogation pipeline as each node runs.
import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";
import { AGENT_NODE } from "./schema";

export const stream = query({
  args: { sessionId: v.id("complianceSessions") },
  handler: (ctx, { sessionId }) =>
    ctx.db
      .query("agentMonologue")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect(),
});

export const log = internalMutation({
  args: {
    sessionId: v.id("complianceSessions"),
    agent: AGENT_NODE,
    status: v.union(v.literal("thinking"), v.literal("done"), v.literal("error")),
    message: v.string(),
    tokensPerSec: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    await ctx.db.insert("agentMonologue", { ...a, at: Date.now() });
  },
});
