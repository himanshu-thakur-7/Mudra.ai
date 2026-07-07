// ============================================================================
//  Pattern 1 — the Pre-Emptive "Detective" Loop (pre-retrieval).
//  A vague marketing draft is a terrible vector-search query. The Detective
//  agent first EXPANDS it into 3-5 precise, technical regulatory search strings
//  (via a forced Hermes function call), then fans those out across the corpus
//  vector index concurrently. This surfaces clauses the raw draft would miss.
// ============================================================================
"use node";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { hermes, HERMES_MODEL, embed } from "./nous";
import type OpenAI from "openai";

// ---- Hermes tool schema (exported so the UI/tests can introspect it) -------
export const EXPAND_LEGAL_QUERIES_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "expand_legal_queries",
    description:
      "Expand a vague or promotional financial-marketing draft into 3-5 precise, " +
      "technical search strings targeting specific Indian regulatory obligations " +
      "(SEBI Advertisement Code, AMFI Code of Conduct, RBI Digital Lending, IRDAI " +
      "Advertisement Regulations). Each string should read like a compliance " +
      "officer's query, naming the exact prohibition or mandatory disclosure at risk.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        queries: {
          type: "array",
          minItems: 3,
          maxItems: 5,
          items: { type: "string" },
          description:
            "Technical regulatory search strings, e.g. " +
            "'SEBI advertisement code prohibition on assured or guaranteed returns for research analysts'.",
        },
      },
      required: ["queries"],
    },
  },
};

interface ExpandLegalQueriesArgs {
  queries: string[];
}

interface CandidateClause {
  corpusId: Id<"regulatoryCorpus">;
  clauseId: string;
  regulator: string;
  cleanMarkdown: string;
  score: number; // best cosine score across the queries that surfaced it
  matchedQuery: string;
}

const DETECTIVE_SYSTEM =
  "You are the DETECTIVE inside Mudra.ai — a forensic compliance analyst. Given a " +
  "marketing draft, you never answer directly; you decompose it into the precise " +
  "regulatory questions it raises and call expand_legal_queries with them. Think " +
  "about assured-return claims, scheme-specific recommendations, missing mandatory " +
  "disclosures (ARN, tagline, risk warnings), superlatives, and dark patterns.";

export const investigate = action({
  args: { sessionId: v.id("complianceSessions"), draft: v.string() },
  handler: async (ctx, { sessionId, draft }): Promise<CandidateClause[]> => {
    const client = hermes();

    // 1) Force the query-expansion function call.
    const completion = await client.chat.completions.create({
      model: HERMES_MODEL,
      messages: [
        { role: "system", content: DETECTIVE_SYSTEM },
        { role: "user", content: `Draft to investigate:\n"""${draft}"""` },
      ],
      tools: [EXPAND_LEGAL_QUERIES_TOOL],
      tool_choice: { type: "function", function: { name: "expand_legal_queries" } },
    });

    const call = completion.choices[0]?.message.tool_calls?.[0];
    if (!call || call.function.name !== "expand_legal_queries") {
      throw new Error("Detective did not return expand_legal_queries");
    }
    const parsed = JSON.parse(call.function.arguments) as ExpandLegalQueriesArgs;
    const queries = (parsed.queries ?? []).filter((q) => typeof q === "string" && q.trim().length > 0).slice(0, 5);
    if (queries.length === 0) throw new Error("Detective produced no queries");

    await ctx.runMutation(internal.monologue.append, {
      sessionId,
      activeNode: "Detective",
      thoughtDetails: `Expanded the draft into ${queries.length} technical queries: ${queries.map((q) => `“${q}”`).join(" · ")}`,
    });

    // 2) Fan out: embed + vector-search each query CONCURRENTLY.
    const perQuery = await Promise.all(
      queries.map(async (query) => {
        const vector = await embed(query);
        const hits = await ctx.vectorSearch("regulatoryCorpus", "by_embedding", {
          vector,
          limit: 6,
          filter: (f) => f.eq("status", "ACTIVE"), // temporal hard-filter
        });
        return hits.map((h) => ({ id: h._id, score: h._score, query }));
      }),
    );

    // 3) Merge + dedupe by corpus id, keeping the best score per clause.
    const best = new Map<Id<"regulatoryCorpus">, { score: number; query: string }>();
    for (const list of perQuery) {
      for (const h of list) {
        const cur = best.get(h.id);
        if (!cur || h.score > cur.score) best.set(h.id, { score: h.score, query: h.query });
      }
    }
    const ids = [...best.keys()];
    const docs = await ctx.runQuery(internal.corpus.hydrate, { ids });

    const candidates: CandidateClause[] = docs
      .map((d: any) => ({
        corpusId: d._id as Id<"regulatoryCorpus">,
        clauseId: d.clauseId as string,
        regulator: d.regulator as string,
        cleanMarkdown: (d.cleanMarkdown || d.rawText) as string,
        score: best.get(d._id)?.score ?? 0,
        matchedQuery: best.get(d._id)?.query ?? "",
      }))
      .sort((a, b) => b.score - a.score);

    await ctx.runMutation(internal.monologue.append, {
      sessionId,
      activeNode: "Retriever",
      thoughtDetails: `Fanned out ${queries.length} searches → ${candidates.length} unique active clauses across ${new Set(candidates.map((c) => c.regulator)).size} regulators.`,
    });

    return candidates;
  },
});
