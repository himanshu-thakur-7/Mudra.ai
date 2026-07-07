// ============================================================================
//  Mudra.ai — shared Nous Hermes / OpenAI clients (official OpenAI SDK).
//  Hermes speaks the OpenAI-compatible API, so a single SDK serves both. When
//  CF_AI_GATEWAY_BASE is set every call is routed through the Cloudflare AI
//  Gateway (provider segment: /compat for Hermes, /openai for OpenAI).
//  Imported by the Node-runtime agent actions (detective / debate / director).
// ============================================================================
import OpenAI from "openai";

const gw = (): string | undefined => process.env.CF_AI_GATEWAY_BASE?.replace(/\/$/, "");

export const HERMES_MODEL = process.env.HERMES_MODEL ?? "Hermes-3-Llama-3.1-405B";
export const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";

/** Nous Hermes via the OpenAI SDK (function calling + strict JSON). */
export function hermes(): OpenAI {
  const g = gw();
  return new OpenAI({
    apiKey: process.env.HERMES_API_KEY ?? process.env.OPENAI_API_KEY ?? "",
    baseURL: g ? `${g}/compat` : (process.env.HERMES_BASE_URL ?? "https://inference-api.nousresearch.com/v1"),
  });
}

/** OpenAI (embeddings + GPT-5.5 heavy lifting). */
export function openai(): OpenAI {
  const g = gw();
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY ?? "",
    baseURL: g ? `${g}/openai` : "https://api.openai.com/v1",
  });
}

export async function embed(text: string): Promise<number[]> {
  const res = await openai().embeddings.create({ model: EMBEDDING_MODEL, input: text });
  return res.data[0].embedding;
}
