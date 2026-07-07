// ============================================================================
//  Mudra.ai — THE THEATER ENGINE
//  A single Convex action orchestrates the whole multi-agent interrogation and
//  streams every state change back to the UI via reactive mutations. There is
//  no request/response: the frontend subscribes to the session, the monologue,
//  and the violations, and re-renders the War Room / Risk Radar / Strikethrough
//  editor live over Convex's WebSocket sync as each mutation lands.
//
//    QUEUED → REVIEWING(Reviewer) → [SEARCHING_LIVE(Linkup)] →
//    ADJUDICATING(Adjudicator, strict JSON) → VOICE_STREAMING(ElevenLabs) →
//    REMEDIATING(Remediator) → COMPLETED
// ============================================================================
"use node";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { structured, complete, chatWithTools, activeAgentProvider } from "./hermes";
import { ADJUDICATOR_SYSTEM, REVIEWER_SYSTEM, REMEDIATOR_SYSTEM, AUDIENCE_LABEL, VIOLATIONS_JSON_SCHEMA } from "./prompts";
import { SEARCH_LIVE_REGULATIONS_TOOL } from "./linkup";

// ---- financial-exposure model (drives the ₹546 Cr Risk Radar) --------------
// Representative per-entity exposure anchored to real enforcement: SEBI
// finfluencer/assured-return crackdowns run to crores; RBI FY24-25 imposed 353
// penalties (~₹54.78cr). These are per-violation contributions, not aggregates.
const SEVERITY_BASE_INR: Record<string, number> = { critical: 2_500_000, major: 500_000, minor: 50_000 };
const REGULATOR_MULT: Record<string, number> = { SEBI: 1.5, RBI: 1.3, AMFI: 1.0, IRDAI: 1.1 };

function exposureFor(severity: string, regulator: string, confidence: number): number {
  return Math.round((SEVERITY_BASE_INR[severity] ?? 50_000) * (REGULATOR_MULT[regulator] ?? 1) * (0.6 + 0.4 * confidence));
}
// Map cumulative ₹ exposure → 0..100 radar score (log curve); any critical pins it hot.
function riskScore(exposureInr: number, hasCritical: boolean): number {
  const base = Math.min(100, Math.round((Math.log10(1 + exposureInr) / Math.log10(50_000_000)) * 100));
  return hasCritical ? Math.max(82, base) : base;
}

export const run = internalAction({
  args: { sessionId: v.id("complianceSessions") },
  handler: async (ctx, { sessionId }) => {
    const provider = activeAgentProvider();
    const session = await ctx.runQuery(api.sessions.get, { sessionId });
    if (!session) return;
    const { draft, draftSentences, audience, channel } = session;

    const log = (agent: any, status: any, message: string, tps?: number) =>
      ctx.runMutation(internal.monologue.log, { sessionId, agent, status, message, tokensPerSec: tps });

    try {
      // ---------- 1. RETRIEVAL --------------------------------------------
      await ctx.runMutation(internal.sessions.setStatus, { sessionId, status: "REVIEWING", activeAgent: "Reviewer" });
      await log("Reviewer", "thinking", "Reading the draft and pulling the applicable rulebook…");
      const clauses = await ctx.runAction(api.corpus.search, { query: draft, audience, k: 14 });
      const clauseBlock = clauses
        .map((c: any) => `[${c.clauseId}] (${c.regulator}${c.mandatory ? ", MANDATORY" : ""}, p.${c.sourcePage ?? "?"})\n${c.text}`)
        .join("\n\n");
      const clauseById = new Map(clauses.map((c: any) => [c.clauseId, c]));
      await log("Reviewer", "done", `Retrieved ${clauses.length} active clauses across ${new Set(clauses.map((c: any) => c.regulator)).size} regulators.`);

      // ---------- 2. REVIEWER (may call Linkup live) ----------------------
      await log("Reviewer", "thinking", "Scanning for plausible violations…");
      const reviewerNote = await chatWithTools(
        `${REVIEWER_SYSTEM}`,
        `AUDIENCE: ${AUDIENCE_LABEL[audience] ?? audience}\nCHANNEL: ${channel}\n\nCLAUSES:\n${clauseBlock}\n\nDRAFT:\n"""${draft}"""`,
        [SEARCH_LIVE_REGULATIONS_TOOL],
        {
          search_live_regulations: async (a: any) => {
            await ctx.runMutation(internal.sessions.setStatus, { sessionId, status: "SEARCHING_LIVE", activeAgent: "LinkupSearch" });
            await log("LinkupSearch", "thinking", `Searching live: "${a.query}" (${a.regulator})…`);
            const result = await ctx.runAction(api.linkup.searchLiveRegulations, { query: a.query, regulator: a.regulator, audience });
            await log("LinkupSearch", "done", "Fetched and ingested the latest circular into the vector store.");
            await ctx.runMutation(internal.sessions.setStatus, { sessionId, status: "REVIEWING", activeAgent: "Reviewer" });
            return result;
          },
        },
      );
      await log("Reviewer", "done", "First-pass findings handed to the Adjudicator.");

      // ---------- 3. ADJUDICATOR (strict JSON, Hermes) -------------------
      await ctx.runMutation(internal.sessions.setStatus, { sessionId, status: "ADJUDICATING", activeAgent: "Adjudicator" });
      await log("Adjudicator", "thinking", "Ruling on each finding against the verbatim clauses…");
      const adjSystem = ADJUDICATOR_SYSTEM
        .replace("{AUDIENCE_LABEL}", AUDIENCE_LABEL[audience] ?? audience)
        .replace("{CHANNEL}", channel);
      const adjUser = `CLAUSES (the only citable authorities):\n${clauseBlock}\n\nDRAFT (0-indexed sentences):\n${draftSentences.map((s, i) => `[${i}] ${s}`).join("\n")}\n\nREVIEWER_NOTES:\n${reviewerNote}\n\nReturn the strict violations JSON.`;
      const ruling = await structured(adjSystem, adjUser, "violations", VIOLATIONS_JSON_SCHEMA as object);

      // ---------- 4. VALIDATE + STREAM violations + risk + VOICE ---------
      await ctx.runMutation(internal.sessions.setStatus, { sessionId, status: "VOICE_STREAMING", activeAgent: "VoiceOfficer" });
      let cumExposure = 0;
      let hasCritical = false;
      const rawViolations: any[] = Array.isArray(ruling.violations) ? ruling.violations : [];
      for (const vio of rawViolations) {
        const clause = clauseById.get(vio.clause_id);
        if (!clause) continue; // hallucinated citation — structurally dropped
        if (vio.severity === "critical") hasCritical = true;
        const exposure = exposureFor(vio.severity, clause.regulator, vio.confidence ?? 0.8);
        cumExposure += exposure;

        await ctx.runMutation(internal.violations.add, {
          sessionId,
          corpusId: clause._id,
          clauseId: vio.clause_id,
          severity: vio.severity,
          category: vio.category ?? "other",
          offendingText: vio.offending_text ?? "",
          sentenceIndex: typeof vio.sentence_index === "number" && vio.sentence_index >= 0 ? vio.sentence_index : undefined,
          rationale: vio.rationale ?? "",
          suggestedFix: vio.suggested_fix ?? "",
          exposureWeight: exposure,
          confidence: vio.confidence ?? 0.8,
          adjudication: "upheld",
        });

        // Bump the Risk Radar the instant each violation lands (reactive).
        await ctx.runMutation(internal.sessions.bumpRisk, {
          sessionId,
          riskScore: riskScore(cumExposure, hasCritical),
          exposureInr: cumExposure,
        });

        // Voice Officer reads the violation aloud (ElevenLabs → storage → UI).
        await log("VoiceOfficer", "thinking", `Reading out: ${vio.clause_id}`);
        await ctx.runAction(api.elevenlabs.speakSegment, {
          sessionId,
          text: `${vio.severity} issue. ${vio.rationale}`,
        });
      }
      await log("Adjudicator", "done", `${rawViolations.length} violation(s) upheld. Verdict: ${ruling.verdict}.`);

      // ---------- 5. REMEDIATOR ------------------------------------------
      let rewrite: string | undefined;
      if (ruling.verdict !== "pass" && rawViolations.length) {
        await ctx.runMutation(internal.sessions.setStatus, { sessionId, status: "REMEDIATING", activeAgent: "Remediator" });
        await log("Remediator", "thinking", "Drafting one cohesive compliant rewrite…");
        const vlist = rawViolations.map((x) => `- ${x.rationale} (${x.clause_id})`).join("\n");
        rewrite = await complete(
          REMEDIATOR_SYSTEM,
          `AUDIENCE: ${AUDIENCE_LABEL[audience] ?? audience}\n\nVIOLATIONS:\n${vlist}\n\nORIGINAL DRAFT:\n"""${draft}"""`,
        );
        await log("Remediator", "done", "Compliant version ready.");
        await ctx.runAction(api.elevenlabs.speakSegment, { sessionId, text: `Here is a version you can post. ${rewrite}` });
      }

      // ---------- 6. FINALIZE -------------------------------------------
      await ctx.runMutation(internal.sessions.finalize, {
        sessionId,
        verdict: ruling.verdict === "pass" ? "pass" : ruling.verdict === "fail" || hasCritical ? "fail" : "needs_changes",
        rewrittenText: rewrite,
        summary: `${rawViolations.length} issue(s) · ₹${(cumExposure / 100000).toFixed(1)}L estimated exposure`,
        riskScore: riskScore(cumExposure, hasCritical),
        exposureInr: cumExposure,
        provider,
      });
    } catch (err: any) {
      await log("Adjudicator", "error", `Pipeline error: ${err?.message ?? err}`);
      await ctx.runMutation(internal.sessions.finalize, {
        sessionId, verdict: "error", riskScore: 0, exposureInr: 0, provider,
      });
    }
  },
});
