// ============================================================================
//  Mudra.ai — Phase 2: centralized agent orchestration in Convex.
//  The ENTIRE agentic pipeline runs here as a serverless action. Python does
//  no orchestration and no vector storage — it only feeds `regulatoryCorpus`.
// ============================================================================
import { v } from "convex/values";
import { action, mutation } from "./_generated/server";
import { api, internal } from "./_generated/api";

// The uncompromising regulatory-authority prompt. Forces a JSON object whose
// `violations` array maps 1:1 onto the violations table.
const ADJUDICATOR_SYSTEM = `You are the ADJUDICATOR inside Mudra.ai — a SEBI/AMFI/RBI/IRDAI enforcement officer who has personally signed multi-crore penalty orders. Under SEBI Regulation 16C the regulated entity is SOLELY liable for anything published, so you are literal, evidence-bound and give no benefit of the doubt.

You are given the DRAFT and a numbered list of ACTIVE regulatory CLAUSES (the only citable authorities). Rules:
1. Cite ONLY a clauseId that appears verbatim in the CLAUSES list. Never invent, guess or renumber one. If nothing supports a suspicion, stay silent.
2. targetPhrase MUST be an exact substring of the DRAFT, or the literal "(missing: <required disclosure>)".
3. criticality: "critical" = prohibited claim (assured/guaranteed returns, guaranteed loan approval, guaranteed insurance benefit, clearly misleading); "major" = missing mandatory disclosure or prohibited conduct; "minor" = format/technical.
Respond with ONLY a JSON object of the exact shape:
{"verdict":"pass|needs_changes|fail","violations":[{"clauseId":"...","targetPhrase":"...","criticality":"critical|major|minor","explanation":"...","suggestedFix":"..."}]}`;

// ---- Phase 2.1: mutation to stream a thought into the War Room -------------
export const appendThought = mutation({
  args: {
    sessionId: v.id("complianceSessions"),
    activeNode: v.union(
      v.literal("Embedder"), v.literal("Retriever"), v.literal("Adjudicator"),
      v.literal("Remediator"), v.literal("VoiceOfficer"),
    ),
    thoughtDetails: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("agentMonologue", { ...args, timestamp: Date.now() });
  },
});

// ---- OpenAI embedding (routed through Cloudflare AI Gateway when set) ------
function gatewayBase(provider: "openai" | "compat"): string {
  const gw = process.env.CF_AI_GATEWAY_BASE;
  if (gw) return `${gw.replace(/\/$/, "")}/${provider}`;
  return provider === "openai"
    ? "https://api.openai.com/v1"
    : (process.env.HERMES_BASE_URL ?? "https://inference-api.nousresearch.com/v1");
}

async function embedDraft(text: string): Promise<number[]> {
  const res = await fetch(`${gatewayBase("openai")}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small", input: text }),
  });
  if (!res.ok) throw new Error(`OpenAI embeddings ${res.status}: ${await res.text()}`);
  return (await res.json()).data[0].embedding;
}

const CRIT_WEIGHT: Record<string, number> = { critical: 40, major: 18, minor: 6 };

// ---- Phase 2.2: the full compliance pipeline, in one Convex action --------
export const runCompliancePipeline = action({
  args: { sessionId: v.id("complianceSessions"), textDraft: v.string() },
  handler: async (ctx, { sessionId, textDraft }) => {
    const say = (node: any, msg: string) =>
      ctx.runMutation(api.hermes.appendThought, { sessionId, activeNode: node, thoughtDetails: msg });

    try {
      // 1) EMBED
      await ctx.runMutation(internal.sessions.setStatus, { sessionId, sessionStatus: "EMBEDDING" });
      await say("Embedder", "Vectorising the draft for semantic retrieval…");
      const vector = await embedDraft(textDraft);

      // 2) NATIVE CONVEX VECTOR SEARCH — ACTIVE rules only
      await ctx.runMutation(internal.sessions.setStatus, { sessionId, sessionStatus: "RETRIEVING" });
      await say("Retriever", "Searching the regulatory corpus for active rules…");
      const hits = await ctx.vectorSearch("regulatoryCorpus", "by_embedding", {
        vector,
        limit: 12,
        filter: (q) => q.eq("status", "ACTIVE"),
      });
      const docs = await ctx.runQuery(internal.corpus.hydrate, { ids: hits.map((h) => h._id) });
      await say("Retriever", `Retrieved ${docs.length} active clauses across ${new Set(docs.map((d: any) => d.regulator)).size} regulators.`);

      // 3) NOUS HERMES 3 via Cloudflare AI Gateway — strict JSON object
      await ctx.runMutation(internal.sessions.setStatus, { sessionId, sessionStatus: "ADJUDICATING" });
      await say("Adjudicator", "Ruling on the draft against the verbatim clauses…");
      const clauseBlock = docs
        .map((d: any) => `[${d.clauseId}] (${d.regulator})\n${d.cleanMarkdown || d.rawText}`)
        .join("\n\n");
      const hermesRes = await fetch(`${gatewayBase("compat")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.HERMES_API_KEY ?? process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: process.env.HERMES_MODEL ?? "Hermes-3-Llama-3.1-405B",
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: ADJUDICATOR_SYSTEM },
            { role: "user", content: `CLAUSES:\n${clauseBlock}\n\nDRAFT:\n"""${textDraft}"""` },
          ],
        }),
      });
      if (!hermesRes.ok) throw new Error(`Hermes ${hermesRes.status}: ${await hermesRes.text()}`);
      const ruling = JSON.parse((await hermesRes.json()).choices[0].message.content);
      const rawViolations: any[] = Array.isArray(ruling.violations) ? ruling.violations : [];

      // 4) VALIDATE citations + batch insert violations, compute risk
      const byClause = new Map(docs.map((d: any) => [d.clauseId, d]));
      let risk = 0;
      const rows = rawViolations
        .filter((x) => byClause.has(x.clauseId)) // hallucinated citations dropped
        .map((x) => {
          risk += CRIT_WEIGHT[x.criticality] ?? 5;
          return {
            corpusId: byClause.get(x.clauseId)!._id,
            targetPhrase: x.targetPhrase ?? "",
            criticality: x.criticality,
            explanation: x.explanation ?? "",
            suggestedFix: x.suggestedFix ?? "",
          };
        });
      risk = Math.min(100, risk);
      await ctx.runMutation(internal.violations.batchInsert, { sessionId, rows });
      await say("Adjudicator", `${rows.length} violation(s) upheld. Risk score ${risk}. Verdict: ${ruling.verdict}.`);
      await ctx.runMutation(internal.sessions.setRisk, { sessionId, riskScore: risk });

      // 5) VOICE hand-off (the UI plays the stream while the radar pulses)
      await ctx.runMutation(internal.sessions.setStatus, { sessionId, sessionStatus: "VOICE_STREAMING" });
      await say("VoiceOfficer", "Reading the verdict aloud…");

      // 6) REMEDIATOR — one cohesive compliant rewrite
      let remediated: string | undefined;
      if (ruling.verdict !== "pass" && rows.length) {
        await ctx.runMutation(internal.sessions.setStatus, { sessionId, sessionStatus: "REMEDIATING" });
        await say("Remediator", "Drafting one compliant rewrite that resolves every violation…");
        remediated = await remediate(textDraft, rows);
        await say("Remediator", "Compliant version ready.");
      }

      await ctx.runMutation(internal.sessions.complete, {
        sessionId, riskScore: risk, remediatedText: remediated,
      });
    } catch (err: any) {
      await say("Adjudicator", `Pipeline error: ${err?.message ?? err}`);
      await ctx.runMutation(internal.sessions.setStatus, { sessionId, sessionStatus: "ERROR" });
    }
  },
});

async function remediate(draft: string, rows: { explanation: string }[]): Promise<string> {
  const res = await fetch(`${gatewayBase("compat")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.HERMES_API_KEY ?? process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.HERMES_MODEL ?? "Hermes-3-Llama-3.1-405B",
      messages: [
        {
          role: "system",
          content:
            "You are the REMEDIATOR. Rewrite the draft into ONE publish-ready version that resolves every violation, preserving the author's voice and language, inserting all mandatory disclosures (ARN + tagline + risk warning for MFDs). Output ONLY the rewritten text.",
        },
        { role: "user", content: `VIOLATIONS:\n${rows.map((r) => `- ${r.explanation}`).join("\n")}\n\nDRAFT:\n"""${draft}"""` },
      ],
    }),
  });
  if (!res.ok) return "";
  return (await res.json()).choices[0].message.content ?? "";
}
