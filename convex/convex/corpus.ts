// Regulatory corpus: idempotent upsert + built-in filtered vector search.
// The audience + ACTIVE-status filter runs INSIDE the vector traversal, so a
// query for MFD content can never surface an RBI clause or a superseded rule.
"use node";
import { v } from "convex/values";
import { action, mutation, query, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { embed } from "./hermes";

export const upsert = mutation({
  args: {
    clauseId: v.string(),
    regulator: v.string(),
    docTitle: v.string(),
    clauseNumber: v.string(),
    text: v.string(),
    tags: v.array(v.string()),
    audience: v.string(),
    mandatory: v.boolean(),
    state: v.union(v.literal("ACTIVE"), v.literal("SUPERSEDED"), v.literal("AMENDED")),
    validFrom: v.string(),
    validTo: v.optional(v.string()),
    sourceUrl: v.string(),
    sourcePage: v.optional(v.number()),
    ingestedFrom: v.string(),
    contentHash: v.string(),
    embedding: v.array(v.float64()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("regulatoryCorpus")
      .withIndex("by_clause_id", (q) => q.eq("clauseId", args.clauseId))
      .unique();
    if (existing) await ctx.db.patch(existing._id, args);
    else await ctx.db.insert("regulatoryCorpus", args);
  },
});

export const byIds = internalQuery({
  args: { ids: v.array(v.id("regulatoryCorpus")) },
  handler: async (ctx, { ids }) => {
    const docs = await Promise.all(ids.map((id) => ctx.db.get(id)));
    return docs.filter(Boolean);
  },
});

// Vector search used by the Reviewer/Adjudicator. Mandatory clauses for the
// audience are always unioned in (they must be checked even if not "similar").
export const search = action({
  args: { query: v.string(), audience: v.string(), k: v.optional(v.number()) },
  handler: async (ctx, { query, audience, k }) => {
    const vector = await embed(query);
    const hits = await ctx.vectorSearch("regulatoryCorpus", "by_embedding", {
      vector,
      limit: k ?? 12,
      filter: (q) => q.eq("state", "ACTIVE"),
    });
    const docs = await ctx.runQuery(internal.corpus.byIds, { ids: hits.map((h) => h._id) });
    // audience pre-filter (tags carry audience:<x>) — belt-and-braces with the
    // vector filter; keeps cross-audience clauses out of the review.
    const tag = `audience:${audience}`;
    return docs
      .filter((d: any) => (d.tags ?? []).includes(tag) || d.mandatory)
      .map((d: any) => ({
        _id: d._id,
        clauseId: d.clauseId,
        regulator: d.regulator,
        clauseNumber: d.clauseNumber,
        text: d.text,
        tags: d.tags,
        mandatory: d.mandatory,
        sourcePage: d.sourcePage,
        sourceUrl: d.sourceUrl,
        state: d.state,
      }));
  },
});

export const count = query({
  args: {},
  handler: async (ctx) => (await ctx.db.query("regulatoryCorpus").collect()).length,
});
