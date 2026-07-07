// Session lifecycle + reactive read. `start` is the single public entry point;
// it schedules the Convex-native pipeline and returns the id the UI subscribes to.
import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import { api } from "./_generated/api";
import { SESSION_STATUS } from "./schema";

export const start = mutation({
  args: { userId: v.string(), rawInputDraft: v.string() },
  handler: async (ctx, { userId, rawInputDraft }) => {
    const sessionId = await ctx.db.insert("complianceSessions", {
      userId,
      rawInputDraft,
      sessionStatus: "QUEUED",
      riskScore: 0,
    });
    // Convex owns orchestration: schedule the pipeline action, return immediately.
    await ctx.scheduler.runAfter(0, api.hermes.runCompliancePipeline, { sessionId, textDraft: rawInputDraft });
    return sessionId;
  },
});

export const getSession = query({
  args: { sessionId: v.id("complianceSessions") },
  handler: (ctx, { sessionId }) => ctx.db.get(sessionId),
});

export const setStatus = internalMutation({
  args: { sessionId: v.id("complianceSessions"), sessionStatus: SESSION_STATUS },
  handler: (ctx, { sessionId, sessionStatus }) => ctx.db.patch(sessionId, { sessionStatus }),
});

export const setRisk = internalMutation({
  args: { sessionId: v.id("complianceSessions"), riskScore: v.number() },
  handler: (ctx, { sessionId, riskScore }) => ctx.db.patch(sessionId, { riskScore }),
});

export const complete = internalMutation({
  args: { sessionId: v.id("complianceSessions"), riskScore: v.number(), remediatedText: v.optional(v.string()) },
  handler: (ctx, { sessionId, riskScore, remediatedText }) =>
    ctx.db.patch(sessionId, { sessionStatus: "COMPLETED", riskScore, remediatedText }),
});
