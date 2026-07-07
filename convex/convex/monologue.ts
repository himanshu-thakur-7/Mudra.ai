// Reactive stream of agent thoughts for the Agent Execution Grid.
import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";
import { AGENT_NODE } from "./schema";

export const getMonologue = query({
  args: { sessionId: v.id("complianceSessions") },
  handler: (ctx, { sessionId }) =>
    ctx.db
      .query("agentMonologue")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .collect(),
});

// Internal append used by the Node-runtime agent actions (detective/debate/
// director) to stream a thought into the War Room from any node.
export const append = internalMutation({
  args: {
    sessionId: v.id("complianceSessions"),
    activeNode: AGENT_NODE,
    thoughtDetails: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("agentMonologue", { ...args, timestamp: Date.now() });
  },
});
