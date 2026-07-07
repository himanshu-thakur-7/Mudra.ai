// ============================================================================
//  Pattern 2 — the Adversarial "Red Team" Debate (multi-agent state machine).
//  Agent A (Aggressive Marketer) keeps trying to rewrite a flagged chunk to be
//  catchy while sneaking past the rule; Agent B (Unforgiving SEBI Officer)
//  attacks each attempt against the retrieved clause. The loop is bounded to 3
//  rounds and breaks the moment Agent B certifies {"status":"COMPLIANT"}. Every
//  turn streams to agentMonologue, so the War Room renders the fight live.
// ============================================================================
"use node";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { hermes, HERMES_MODEL } from "./nous";

const MAX_ROUNDS = 3;

const MARKETER_SYSTEM =
  "You are AGENT A — an aggressive Indian mutual-fund/insurance marketer. Your job " +
  "is to make the flagged text as catchy and conversion-driving as possible while " +
  "trying to slip past the compliance rule. You will be attacked by a SEBI officer; " +
  "when you receive their objection, adapt cleverly. Respond with ONLY the rewritten " +
  "marketing text — no commentary.";

const OFFICER_SYSTEM =
  "You are AGENT B — an unforgiving SEBI/AMFI enforcement officer. You are shown a " +
  "regulatory CLAUSE and a marketer's REWRITE. Rule on whether the rewrite fully " +
  "complies with that clause. Be literal and skeptical; assured/guaranteed returns, " +
  "scheme-specific push, or missing mandatory disclosures are never acceptable. " +
  'Respond with ONLY JSON: {"status":"COMPLIANT"|"NON_COMPLIANT","attack":"<your objection or approval, one or two sentences>","citation":"<clauseId>"}.';

interface OfficerVerdict {
  status: "COMPLIANT" | "NON_COMPLIANT";
  attack: string;
  citation?: string;
}

export const runAdversarialDebate = action({
  args: { violationId: v.id("violations"), rawText: v.string() },
  handler: async (
    ctx,
    { violationId, rawText },
  ): Promise<{ compliant: boolean; rounds: number; finalText: string }> => {
    const context = await ctx.runQuery(internal.violations.getContext, { violationId });
    if (!context) throw new Error("violation not found");
    const { sessionId, clauseId, clauseText } = context;
    const client = hermes();

    let currentText = rawText;
    let officerAttack = "";
    let compliant = false;
    let round = 0;

    while (round < MAX_ROUNDS) {
      round++;

      // --- Agent A: rewrite (attempt to bypass) ---------------------------
      const aResp = await client.chat.completions.create({
        model: HERMES_MODEL,
        temperature: 0.9,
        messages: [
          { role: "system", content: MARKETER_SYSTEM },
          {
            role: "user",
            content:
              `Flagged text:\n"""${currentText}"""` +
              (officerAttack ? `\n\nThe SEBI officer just objected:\n"${officerAttack}"\nRewrite to be even more compelling while addressing this.` : ""),
          },
        ],
      });
      currentText = (aResp.choices[0]?.message.content ?? currentText).trim();
      await ctx.runMutation(internal.monologue.append, {
        sessionId,
        activeNode: "Marketer",
        thoughtDetails: `Round ${round} — rewrite: “${truncate(currentText)}”`,
      });

      // --- Agent B: attack the rewrite against the clause -----------------
      const bResp = await client.chat.completions.create({
        model: HERMES_MODEL,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: OFFICER_SYSTEM },
          {
            role: "user",
            content: `CLAUSE [${clauseId}]:\n${clauseText}\n\nREWRITE to rule on:\n"""${currentText}"""`,
          },
        ],
      });
      const verdict = safeParse(bResp.choices[0]?.message.content);
      officerAttack = verdict.attack || "(no objection returned)";
      await ctx.runMutation(internal.monologue.append, {
        sessionId,
        activeNode: "SEBIOfficer",
        thoughtDetails: `Round ${round} — ${verdict.status}: ${officerAttack}`,
      });

      if (verdict.status === "COMPLIANT") {
        compliant = true;
        break;
      }
    }

    if (compliant) {
      // Persist the debate-hardened rewrite as the flag's suggested fix.
      await ctx.runMutation(internal.violations.applyDebateOutcome, {
        violationId,
        suggestedFix: currentText,
      });
    } else {
      await ctx.runMutation(internal.monologue.append, {
        sessionId,
        activeNode: "SEBIOfficer",
        thoughtDetails: `No compliant rewrite after ${MAX_ROUNDS} rounds — escalating to a human compliance officer.`,
      });
    }

    return { compliant, rounds: round, finalText: currentText };
  },
});

function truncate(s: string, n = 140): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function safeParse(content: string | null | undefined): OfficerVerdict {
  try {
    const obj = JSON.parse(content ?? "{}");
    const status = obj.status === "COMPLIANT" ? "COMPLIANT" : "NON_COMPLIANT";
    return { status, attack: String(obj.attack ?? ""), citation: obj.citation };
  } catch {
    // A parse failure is treated as non-compliant — never certify by accident.
    return { status: "NON_COMPLIANT", attack: "Officer response was unparseable; treating as non-compliant." };
  }
}
