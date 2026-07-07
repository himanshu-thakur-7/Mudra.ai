// ElevenLabs low-latency TTS. Each violation's rationale (and the final
// rewrite) is synthesised into an audio segment, stored in Convex file
// storage, and its storage key pushed onto the session — the UI plays the
// clips in order while the strikethroughs animate. Without a key, the
// frontend falls back to the browser speech engine on the same script.
"use node";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";

export function voiceAvailable(): boolean {
  return !!process.env.ELEVENLABS_API_KEY;
}

// Synthesise one line, store it, attach to the session. Returns the storage id
// (or null when unconfigured — the UI then uses browser speech).
export const speakSegment = action({
  args: { sessionId: v.id("complianceSessions"), text: v.string() },
  handler: async (ctx, { sessionId, text }): Promise<string | null> => {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) return null;
    const voice = process.env.ELEVENLABS_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb";
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
      method: "POST",
      headers: { "xi-api-key": apiKey, accept: "audio/mpeg", "content-type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: process.env.ELEVENLABS_MODEL ?? "eleven_turbo_v2_5",
        voice_settings: { stability: 0.4, similarity_boost: 0.75, style: 0.15 },
      }),
    });
    if (!res.ok) return null;
    const blob = await res.blob();
    const storageId = await ctx.storage.store(blob);
    await ctx.runMutation(internal.sessions.addVoiceClip, { sessionId, storageKey: storageId });
    return storageId;
  },
});
