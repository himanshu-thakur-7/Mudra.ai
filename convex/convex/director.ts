// ============================================================================
//  Pattern 3 — Autonomous Emotional Steerage (the "Director" agent).
//  Hermes decides HOW the compliance officer should sound based on the financial
//  risk of a flag: a minor format nit is read casually; a guaranteed-returns
//  breach is read urgently. It calls set_voice_parameters (a forced function
//  call); we map its choice to concrete ElevenLabs voice_settings, synthesise
//  the audio, store it, and push the clip onto the session for the UI to play.
// ============================================================================
"use node";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { hermes, HERMES_MODEL } from "./nous";
import type OpenAI from "openai";

// ---- Hermes tool schema ----------------------------------------------------
export const SET_VOICE_PARAMETERS_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "set_voice_parameters",
    description:
      "Choose how the compliance officer's voice should sound when reading this " +
      "violation aloud, based on its financial and regulatory severity. A trivial " +
      "format issue is casual; a prohibited-claim breach with large penalty exposure " +
      "is urgent.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        emotion: {
          type: "string",
          enum: ["casual", "stern", "urgent"],
          description: "Overall delivery tone.",
        },
        pace: {
          type: "number",
          description: "Speaking pace multiplier, 0.7 (slow/grave) to 1.2 (fast/urgent).",
        },
        severity: {
          type: "integer",
          minimum: 1,
          maximum: 10,
          description: "Perceived financial/regulatory severity, 1 (trivial) to 10 (career-ending).",
        },
      },
      required: ["emotion", "pace", "severity"],
    },
  },
};

type Emotion = "casual" | "stern" | "urgent";
interface VoiceParameters {
  emotion: Emotion;
  pace: number;
  severity: number;
}

// Concrete ElevenLabs voice_settings per emotion. Lower stability = more
// expressive/variable delivery; higher style pushes intensity.
const EMOTION_PROFILE: Record<Emotion, { stability: number; similarity_boost: number; style: number }> = {
  casual: { stability: 0.55, similarity_boost: 0.7, style: 0.05 },
  stern: { stability: 0.28, similarity_boost: 0.85, style: 0.35 },
  urgent: { stability: 0.14, similarity_boost: 0.9, style: 0.6 },
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

const DIRECTOR_SYSTEM =
  "You are the DIRECTOR inside Mudra.ai. You do not speak; you decide the emotional " +
  "delivery of the compliance officer's voice. Given a violation and its severity, " +
  "call set_voice_parameters. Guaranteed/assured-return breaches and anything with " +
  "large penalty exposure must be urgent; missing disclosures are stern; minor " +
  "format issues are casual.";

export const directVoice = action({
  args: { violationId: v.id("violations") },
  handler: async (ctx, { violationId }): Promise<{ emotion: Emotion; params: VoiceParameters; url: string | null }> => {
    const ctxV = await ctx.runQuery(internal.violations.getContext, { violationId });
    if (!ctxV) throw new Error("violation not found");
    const { sessionId, clauseId, criticality, explanation, targetPhrase } = ctxV;

    // 1) Hermes chooses the delivery (forced function call).
    const client = hermes();
    const completion = await client.chat.completions.create({
      model: HERMES_MODEL,
      messages: [
        { role: "system", content: DIRECTOR_SYSTEM },
        {
          role: "user",
          content:
            `Violation on clause ${clauseId} (criticality: ${criticality}).\n` +
            `Offending text: "${targetPhrase}"\nWhy it breaches: ${explanation}\n\nChoose the voice parameters.`,
        },
      ],
      tools: [SET_VOICE_PARAMETERS_TOOL],
      tool_choice: { type: "function", function: { name: "set_voice_parameters" } },
    });

    const call = completion.choices[0]?.message.tool_calls?.[0];
    if (!call || call.function.name !== "set_voice_parameters") {
      throw new Error("Director did not return set_voice_parameters");
    }
    const raw = JSON.parse(call.function.arguments) as Partial<VoiceParameters>;
    const params: VoiceParameters = {
      emotion: (["casual", "stern", "urgent"] as const).includes(raw.emotion as Emotion) ? (raw.emotion as Emotion) : "stern",
      pace: clamp(Number(raw.pace ?? 1), 0.7, 1.2),
      severity: clamp(Math.round(Number(raw.severity ?? 5)), 1, 10),
    };

    await ctx.runMutation(internal.monologue.append, {
      sessionId,
      activeNode: "Director",
      thoughtDetails: `Voice → ${params.emotion} (pace ${params.pace.toFixed(2)}, severity ${params.severity}/10) for ${clauseId}.`,
    });

    // 2) Map the director's choice → ElevenLabs voice_settings and synthesise.
    const profile = EMOTION_PROFILE[params.emotion];
    // Higher severity nudges style intensity upward within [0,1].
    const style = clamp(profile.style + (params.severity - 5) * 0.03, 0, 1);
    const speech =
      `${params.emotion === "urgent" ? "Stop. " : ""}This is a ${criticality} compliance issue. ${explanation}`;

    const apiKey = process.env.ELEVENLABS_API_KEY;
    let url: string | null = null;
    if (apiKey) {
      const voiceId = process.env.ELEVENLABS_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb";
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: { "xi-api-key": apiKey, accept: "audio/mpeg", "content-type": "application/json" },
        body: JSON.stringify({
          text: speech,
          model_id: process.env.ELEVENLABS_MODEL ?? "eleven_turbo_v2_5",
          voice_settings: {
            stability: profile.stability,
            similarity_boost: profile.similarity_boost,
            style,
            use_speaker_boost: true,
            speed: params.pace, // director's pace drives ElevenLabs speed
          },
        }),
      });
      if (res.ok) {
        const blob = await res.blob();
        const storageId = (await ctx.storage.store(blob)) as Id<"_storage">;
        url = await ctx.storage.getUrl(storageId);
        // 3) Push the clip onto the session (flips it into VOICE_STREAMING).
        await ctx.runMutation(internal.sessions.attachVoiceClip, {
          sessionId,
          voiceClipId: storageId,
          voiceEmotion: params.emotion,
        });
      }
    }

    return { emotion: params.emotion, params, url };
  },
});
