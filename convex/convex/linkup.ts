// ============================================================================
//  Mudra.ai — Live ingestion via Linkup, wired as a Hermes function call.
//  When the Reviewer suspects the retrieved corpus is stale, Hermes invokes
//  `search_live_regulations`; the executor hits Linkup, embeds the fresh
//  finding with GPT-5.5 embeddings, and upserts it straight into the
//  regulatoryCorpus vector store — so the next retrieval already sees it.
// ============================================================================
"use node";
import { v } from "convex/values";
import { action, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { embed } from "./hermes";

// ---- the tool definition handed to Hermes ---------------------------------
export const SEARCH_LIVE_REGULATIONS_TOOL = {
  type: "function",
  function: {
    name: "search_live_regulations",
    description:
      "Search the live web for the LATEST Indian financial-regulatory circulars, notifications or rules " +
      "(SEBI, RBI, AMFI, IRDAI). Use when the ingested rulebook may pre-date the draft's subject, or the " +
      "draft references a very recent product/scheme/rule. Returns a sourced answer; new findings are " +
      "auto-ingested into the vector store for citation.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string", description: "Natural-language regulatory query" },
        regulator: { type: "string", enum: ["SEBI", "RBI", "AMFI", "IRDAI", "any"] },
        audience: { type: "string", enum: ["mfd", "ia-ra", "nbfc-lsp", "insurance"] },
      },
      required: ["query", "regulator"],
    },
  },
} as const;

async function callLinkup(query: string, regulator: string): Promise<{ answer: string; sources: { name: string; url: string }[] }> {
  const apiKey = process.env.LINKUP_API_KEY;
  if (!apiKey) return { answer: "", sources: [] };
  const scoped = regulator === "any" ? query : `${regulator} ${query} official circular site:gov.in`;
  const res = await fetch(`${process.env.LINKUP_BASE_URL ?? "https://api.linkup.so/v1"}/search`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ q: scoped, depth: "deep", outputType: "sourcedAnswer", includeImages: false }),
  });
  if (!res.ok) return { answer: "", sources: [] };
  const data = await res.json();
  return {
    answer: data.answer ?? "",
    sources: (data.sources ?? []).slice(0, 6).map((s: any) => ({ name: s.name, url: s.url })),
  };
}

// Executor invoked by the Hermes tool-call loop (see interrogate.ts). Also
// callable directly by the "check for newer circulars" dashboard button.
export const searchLiveRegulations = action({
  args: {
    query: v.string(),
    regulator: v.string(),
    audience: v.optional(v.string()),
  },
  handler: async (ctx, { query, regulator, audience }): Promise<string> => {
    const { answer, sources } = await callLinkup(query, regulator);
    if (!answer) return JSON.stringify({ error: "Linkup not configured or no result — rely on the ingested corpus." });

    // Ingest the live finding as a fresh, ACTIVE corpus chunk so it can be
    // cited immediately. contentHash makes the upsert idempotent.
    const primary = sources[0];
    if (primary) {
      const clauseId = `LIVE-${regulator}-${Date.now().toString(36)}`;
      const embedding = await embed(answer);
      await ctx.runMutation(internal.linkup.upsertLiveFinding, {
        clauseId,
        regulator,
        docTitle: primary.name ?? `${regulator} live circular`,
        text: answer.slice(0, 4000),
        audience: audience ?? "mfd",
        sourceUrl: primary.url ?? "",
        embedding,
      });
    }
    return JSON.stringify({ answer, sources });
  },
});

export const upsertLiveFinding = internalMutation({
  args: {
    clauseId: v.string(),
    regulator: v.string(),
    docTitle: v.string(),
    text: v.string(),
    audience: v.string(),
    sourceUrl: v.string(),
    embedding: v.array(v.float64()),
  },
  handler: async (ctx, a) => {
    const contentHash = simpleHash(`${a.regulator}|${a.text}`);
    const existing = await ctx.db
      .query("regulatoryCorpus")
      .withIndex("by_hash", (q) => q.eq("contentHash", contentHash))
      .unique();
    const doc = {
      clauseId: a.clauseId,
      regulator: a.regulator,
      docTitle: a.docTitle,
      clauseNumber: "live",
      text: a.text,
      tags: [`audience:${a.audience}`, "live"],
      audience: a.audience,
      mandatory: false,
      state: "ACTIVE" as const,
      validFrom: new Date().toISOString().slice(0, 10),
      sourceUrl: a.sourceUrl,
      ingestedFrom: "linkup",
      contentHash,
      embedding: a.embedding,
    };
    if (existing) await ctx.db.patch(existing._id, doc);
    else await ctx.db.insert("regulatoryCorpus", doc);
  },
});

function simpleHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}
