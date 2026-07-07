// ============================================================================
//  Mudra.ai — Nous Hermes client (plain helpers used inside Convex actions).
//  Hermes speaks the OpenAI-compatible API, so one fetch wrapper serves both
//  Hermes (agents) and OpenAI (embeddings / GPT-5.5 preprocessing). When
//  CF_AI_GATEWAY_BASE is set, every call is routed through the Cloudflare AI
//  Gateway for latency/cache/token observability.
// ============================================================================

type Msg = { role: string; content: any; tool_calls?: any; tool_call_id?: string; name?: string };

function baseUrl(provider: "hermes" | "openai"): string {
  const gw = process.env.CF_AI_GATEWAY_BASE;
  if (gw) return `${gw.replace(/\/$/, "")}/${provider === "hermes" ? "compat" : "openai"}`;
  return provider === "hermes"
    ? process.env.HERMES_BASE_URL ?? "https://inference-api.nousresearch.com/v1"
    : "https://api.openai.com/v1";
}

function key(provider: "hermes" | "openai"): string {
  // Auto-fallback: without a Hermes key the agent pipeline runs on OpenAI, so
  // the theater works before Hermes credentials are wired.
  if (provider === "hermes") return process.env.HERMES_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
  return process.env.OPENAI_API_KEY ?? "";
}

export function activeAgentProvider(): "hermes" | "openai" {
  return process.env.HERMES_API_KEY ? "hermes" : "openai";
}

function model(provider: "hermes" | "openai"): string {
  return provider === "hermes"
    ? (process.env.HERMES_API_KEY ? (process.env.HERMES_MODEL ?? "Hermes-4-405B") : (process.env.OPENAI_MODEL ?? "gpt-5.1"))
    : (process.env.OPENAI_MODEL ?? "gpt-5.1");
}

async function chat(provider: "hermes" | "openai", body: Record<string, any>): Promise<any> {
  const res = await fetch(`${baseUrl(provider)}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key(provider)}` },
    body: JSON.stringify({ model: model(provider), ...body }),
  });
  if (!res.ok) throw new Error(`${provider} ${res.status}: ${await res.text()}`);
  return res.json();
}

/** Strict schema-constrained JSON (the Adjudicator). Degrades to json_object
 *  if the endpoint rejects strict json_schema. */
export async function structured(system: string, user: string, schemaName: string, schema: object): Promise<any> {
  const provider = activeAgentProvider();
  const messages: Msg[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  try {
    const data = await chat(provider, {
      messages,
      response_format: { type: "json_schema", json_schema: { name: schemaName, strict: true, schema } },
    });
    return JSON.parse(data.choices[0].message.content);
  } catch {
    const data = await chat(provider, {
      messages: [
        { role: "system", content: `${system}\n\nRespond ONLY with JSON matching:\n${JSON.stringify(schema)}` },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    });
    return JSON.parse(data.choices[0].message.content);
  }
}

/** Plain completion (the Remediator rewrite). */
export async function complete(system: string, user: string): Promise<string> {
  const data = await chat(activeAgentProvider(), {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  return data.choices[0].message.content ?? "";
}

/** Function-calling loop (the Reviewer + Linkup live search). `impls` executes
 *  a tool call and returns a string result fed back to Hermes. */
export async function chatWithTools(
  system: string,
  user: string,
  tools: object[],
  impls: Record<string, (args: any) => Promise<string>>,
  maxRounds = 4,
): Promise<string> {
  const provider = activeAgentProvider();
  const messages: Msg[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  for (let i = 0; i < maxRounds; i++) {
    const data = await chat(provider, { messages, tools, tool_choice: "auto" });
    const msg = data.choices[0].message;
    if (!msg.tool_calls?.length) return msg.content ?? "";
    messages.push(msg);
    for (const call of msg.tool_calls) {
      const impl = impls[call.function.name];
      const args = JSON.parse(call.function.arguments || "{}");
      const result = impl ? await impl(args) : `(no impl for ${call.function.name})`;
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }
  return messages[messages.length - 1]?.content ?? "";
}

/** OpenAI embeddings (GPT-5.5 stack) for corpus + query vectors. */
export async function embed(text: string): Promise<number[]> {
  const res = await fetch(`${baseUrl("openai")}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key("openai")}` },
    body: JSON.stringify({ model: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small", input: text }),
  });
  if (!res.ok) throw new Error(`embeddings ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.data[0].embedding;
}
