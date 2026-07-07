// Built-in vector search over the rulebook (replaces Qdrant). The audience +
// ACTIVE-status pre-filter runs inside the vector search, so a query for MFD
// content can never surface an RBI clause or a superseded rule.
import { action, mutation } from "./_generated/server";
import { v } from "convex/values";

export const upsert = mutation({
  args: {
    clauseId: v.string(),
    docId: v.string(),
    regulator: v.string(),
    clauseNumber: v.string(),
    text: v.string(),
    tags: v.array(v.string()),
    mandatory: v.boolean(),
    status: v.string(),
    sourcePage: v.optional(v.number()),
    sourceUrl: v.string(),
    embedding: v.array(v.float64()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("clauses")
      .withIndex("by_clause_id", (q) => q.eq("clauseId", args.clauseId))
      .unique();
    if (existing) await ctx.db.patch(existing._id, args);
    else await ctx.db.insert("clauses", args);
  },
});

export const search = action({
  args: {
    embedding: v.array(v.float64()),
    audienceTag: v.string(), // e.g. "audience:mfd"
    k: v.optional(v.number()),
  },
  handler: async (ctx, { embedding, audienceTag, k }) => {
    const results = await ctx.vectorSearch("clauses", "by_embedding", {
      vector: embedding,
      limit: k ?? 12,
      filter: (q) =>
        q.and(q.eq("status", "ACTIVE"), q.eq("tags", audienceTag)),
    });
    const ids = results.map((r) => r._id);
    const docs = await ctx.runQuery("clauses:byIds" as any, { ids });
    return docs;
  },
});
