"""LLM provider layer for the Buildathon partner stack.

- **Hermes (Nous)** serves the core agent pipeline (reviewer / adjudicator /
  rewriter): strict JSON-schema adherence + function calling. Preferred whenever
  HERMES_API_KEY is set.
- **OpenAI (GPT-5.5)** is the preprocessing engine (vision/OCR on complex PDF
  tables, large-context distillation) and the automatic fallback for the agent
  pipeline so the system runs before Hermes credentials are wired.
- **Cloudflare AI Gateway** — when CF_AI_GATEWAY_BASE is set, every call is
  routed through the gateway for latency/caching/token observability. The
  OpenAI-compatible SDK just points at the gateway URL; nothing else changes.

Both providers speak the OpenAI-compatible API, so a single AsyncOpenAI client
serves both — only key + base_url differ.
"""

import json
from typing import Any, Awaitable, Callable

from openai import AsyncOpenAI

from app.core.config import get_settings

# provider -> Cloudflare AI Gateway path segment (OpenAI native; Hermes via the
# gateway's OpenAI-compatible passthrough).
_CF_SLUG = {"openai": "openai", "hermes": "compat"}


def _base_url(provider: str, native: str) -> str:
    settings = get_settings()
    if settings.cf_ai_gateway_base:
        return f"{settings.cf_ai_gateway_base.rstrip('/')}/{_CF_SLUG[provider]}"
    return native


def _client_for(provider: str) -> tuple[AsyncOpenAI, str]:
    """Returns (client, model) for 'hermes' or 'openai'."""
    settings = get_settings()
    if provider == "hermes":
        return (
            AsyncOpenAI(
                api_key=settings.hermes_api_key or "missing",
                base_url=_base_url("hermes", settings.hermes_base_url),
            ),
            settings.hermes_model,
        )
    return (
        AsyncOpenAI(
            api_key=settings.openai_api_key,
            base_url=_base_url("openai", "https://api.openai.com/v1"),
        ),
        settings.openai_model,
    )


class LLMClient:
    """Agent-pipeline client — Hermes when available, else OpenAI."""

    def __init__(self) -> None:
        settings = get_settings()
        self.provider = settings.agent_provider
        self._client, self._model = _client_for(self.provider)

    async def structured(
        self, system: str, user: str, schema_name: str, schema: dict[str, Any]
    ) -> dict[str, Any]:
        """Schema-validated JSON. Tries strict json_schema; falls back to
        json_object mode for endpoints that don't advertise strict schemas."""
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]
        try:
            resp = await self._client.chat.completions.create(
                model=self._model,
                messages=messages,
                response_format={
                    "type": "json_schema",
                    "json_schema": {"name": schema_name, "strict": True, "schema": schema},
                },
            )
        except Exception:
            # Hermes/other endpoints may not accept strict json_schema — degrade
            # to json_object with the schema inlined in the prompt.
            resp = await self._client.chat.completions.create(
                model=self._model,
                messages=[
                    {"role": "system", "content": system + "\n\nRespond ONLY with JSON matching this schema:\n" + json.dumps(schema)},
                    {"role": "user", "content": user},
                ],
                response_format={"type": "json_object"},
            )
        return json.loads(resp.choices[0].message.content)

    async def chat_with_tools(
        self,
        system: str,
        user: str,
        tools: list[dict[str, Any]],
        tool_impls: dict[str, Callable[[dict], Awaitable[str]]],
        max_rounds: int = 4,
    ) -> str:
        """Function-calling loop — used for the Linkup live-fetch tool. The model
        (Hermes) decides when to call a tool; we execute and feed results back."""
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]
        for _ in range(max_rounds):
            resp = await self._client.chat.completions.create(
                model=self._model, messages=messages, tools=tools, tool_choice="auto"
            )
            msg = resp.choices[0].message
            if not msg.tool_calls:
                return msg.content or ""
            messages.append(msg.model_dump(exclude_none=True))
            for call in msg.tool_calls:
                impl = tool_impls.get(call.function.name)
                args = json.loads(call.function.arguments or "{}")
                result = await impl(args) if impl else f"(no impl for {call.function.name})"
                messages.append({
                    "role": "tool", "tool_call_id": call.id, "content": result,
                })
        # Ran out of rounds — return the last assistant text.
        return messages[-1].get("content", "") if messages else ""


class PreprocessClient:
    """OpenAI GPT-5.5 heavy-lifting: vision/OCR on complex PDF tables, and
    large-context distillation before handing refined context to Hermes."""

    def __init__(self) -> None:
        settings = get_settings()
        self._client, _ = _client_for("openai")
        self._model = settings.openai_preprocess_model

    async def table_to_markdown(self, png_data_url: str) -> str:
        """Vision extraction of a rendered table image into clean Markdown —
        for scanned/complex tables that geometric parsing scrambles."""
        resp = await self._client.chat.completions.create(
            model=self._model,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": "Extract this regulatory table into clean GitHub-flavoured Markdown. Preserve every cell and header exactly. Output only the table."},
                    {"type": "image_url", "image_url": {"url": png_data_url}},
                ],
            }],
        )
        return resp.choices[0].message.content or ""

    async def distill(self, system: str, long_context: str, max_chars: int = 400_000) -> str:
        """Compress a large regulatory document to the passages relevant to the
        review, so Hermes gets a tight, high-signal context window."""
        resp = await self._client.chat.completions.create(
            model=self._model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": long_context[:max_chars]},
            ],
        )
        return resp.choices[0].message.content or ""
