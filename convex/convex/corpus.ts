// Regulatory corpus: idempotent upsert, the internal hydrate the pipeline uses
// to turn vector hits into full docs, and the embedding of ingested chunks.
import { v } from "convex/values";
import { action, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { CORPUS_STATUS } from "./schema";

export const hydrate = internalQuery({
  args: { ids: v.array(v.id("regulatoryCorpus")) },
  handler: async (ctx, { ids }) => {
    const docs = await Promise.all(ids.map((id) => ctx.db.get(id)));
    return docs.filter(Boolean);
  },
});

export const upsert = internalMutation({
  args: {
    regulator: v.string(),
    clauseId: v.string(),
    rawText: v.string(),
    cleanMarkdown: v.string(),
    embedding: v.array(v.float64()),
    validFrom: v.string(),
    validTo: v.optional(v.string()),
    status: CORPUS_STATUS,
    sourcePdfUrl: v.string(),
  },
  handler: async (ctx, doc) => {
    const existing = await ctx.db
      .query("regulatoryCorpus")
      .withIndex("by_clause_id", (q) => q.eq("clauseId", doc.clauseId))
      .unique();
    if (existing) await ctx.db.patch(existing._id, doc);
    else await ctx.db.insert("regulatoryCorpus", doc);
  },
});

export const count = query({
  args: {},
  handler: async (ctx) => (await ctx.db.query("regulatoryCorpus").collect()).length,
});

// Embed one chunk via OpenAI (routed through the AI Gateway when configured).
async function embed(text: string): Promise<number[]> {
  const gw = process.env.CF_AI_GATEWAY_BASE;
  const base = gw ? `${gw.replace(/\/$/, "")}/openai` : "https://api.openai.com/v1";
  const res = await fetch(`${base}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small", input: text }),
  });
  if (!res.ok) throw new Error(`embeddings ${res.status}`);
  return (await res.json()).data[0].embedding;
}

// bulkIngest — the endpoint the Python PyMuPDF worker POSTs structured chunks to
// (via the HTTP action in http.ts). Embeds each chunk and upserts it.
export const bulkIngest = action({
  args: {
    chunks: v.array(
      v.object({
        regulator: v.string(),
        clauseId: v.string(),
        rawText: v.string(),
        cleanMarkdown: v.string(),
        validFrom: v.optional(v.string()),
        status: v.optional(CORPUS_STATUS),
        sourcePdfUrl: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { chunks }): Promise<{ ingested: number }> => {
    let ingested = 0;
    for (const c of chunks) {
      const embedding = await embed(c.cleanMarkdown || c.rawText);
      await ctx.runMutation(internal.corpus.upsert, {
        regulator: c.regulator,
        clauseId: c.clauseId,
        rawText: c.rawText,
        cleanMarkdown: c.cleanMarkdown,
        embedding,
        validFrom: c.validFrom ?? new Date().toISOString().slice(0, 10),
        status: c.status ?? "ACTIVE",
        sourcePdfUrl: c.sourcePdfUrl ?? "",
      });
      ingested++;
    }
    return { ingested };
  },
});
