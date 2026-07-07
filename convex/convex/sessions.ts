// Reactive session functions. The UI binds to `get` (one row) and drives the
// whole theater off its `status`, `riskScore`, `activeAgent` and `rewrittenText`.
import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import { SESSION_STATUS, AGENT_NODE } from "./schema";

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Public entry point the frontend calls to start an interrogation. Returns the
// session id immediately; the pipeline runs async and streams state back.
export const start = mutation({
  args: {
    orgId: v.string(),
    audience: v.string(),
    channel: v.string(),
    draft: v.string(),
  },
  handler: async (ctx, args) => {
    const sessionId = await ctx.db.insert("complianceSessions", {
      orgId: args.orgId,
      audience: args.audience,
      channel: args.channel,
      draft: args.draft,
      draftSentences: splitSentences(args.draft),
      status: "QUEUED",
      riskScore: 0,
      exposureInr: 0,
      voiceClipKeys: [],
      provider: "",
      createdAt: Date.now(),
    });
    // Kick the theater pipeline (in interrogate.ts) without blocking the UI.
    await ctx.scheduler.runAfter(0, (await import("./_generated/api")).internal.interrogate.run, { sessionId });
    return sessionId;
  },
});

export const get = query({
  args: { sessionId: v.id("complianceSessions") },
  handler: (ctx, { sessionId }) => ctx.db.get(sessionId),
});

export const setStatus = internalMutation({
  args: { sessionId: v.id("complianceSessions"), status: SESSION_STATUS, activeAgent: v.optional(AGENT_NODE) },
  handler: async (ctx, { sessionId, status, activeAgent }) => {
    await ctx.db.patch(sessionId, { status, ...(activeAgent ? { activeAgent } : {}) });
  },
});

export const finalize = internalMutation({
  args: {
    sessionId: v.id("complianceSessions"),
    verdict: v.union(v.literal("pass"), v.literal("needs_changes"), v.literal("fail"), v.literal("error")),
    rewrittenText: v.optional(v.string()),
    summary: v.optional(v.string()),
    riskScore: v.number(),
    exposureInr: v.number(),
    provider: v.string(),
  },
  handler: async (ctx, a) => {
    await ctx.db.patch(a.sessionId, {
      status: "COMPLETED",
      verdict: a.verdict,
      rewrittenText: a.rewrittenText,
      summary: a.summary,
      riskScore: a.riskScore,
      exposureInr: a.exposureInr,
      provider: a.provider,
      activeAgent: undefined,
      completedAt: Date.now(),
    });
  },
});

export const bumpRisk = internalMutation({
  args: { sessionId: v.id("complianceSessions"), riskScore: v.number(), exposureInr: v.number() },
  handler: async (ctx, { sessionId, riskScore, exposureInr }) => {
    await ctx.db.patch(sessionId, { riskScore, exposureInr });
  },
});

export const addVoiceClip = internalMutation({
  args: { sessionId: v.id("complianceSessions"), storageKey: v.string() },
  handler: async (ctx, { sessionId, storageKey }) => {
    const s = await ctx.db.get(sessionId);
    if (!s) return;
    await ctx.db.patch(sessionId, { voiceClipKeys: [...s.voiceClipKeys, storageKey] });
  },
});
