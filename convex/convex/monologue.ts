// Reactive stream of agent thoughts for the Agent Execution Grid.
import { v } from "convex/values";
import { query } from "./_generated/server";

export const getMonologue = query({
  args: { sessionId: v.id("complianceSessions") },
  handler: (ctx, { sessionId }) =>
    ctx.db
      .query("agentMonologue")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect(),
});
