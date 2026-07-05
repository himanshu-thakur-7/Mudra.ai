"""Thin async LLM wrapper.

Keeps the provider swappable and centralises structured-output calls: every
agent gets schema-validated JSON back, so downstream code never parses prose.
"""

import json
from typing import Any

from openai import AsyncOpenAI

from app.core.config import get_settings


class LLMClient:
    def __init__(self) -> None:
        settings = get_settings()
        self._client = AsyncOpenAI(api_key=settings.openai_api_key)
        self._model = settings.openai_model

    async def structured(
        self,
        system: str,
        user: str,
        schema_name: str,
        schema: dict[str, Any],
    ) -> dict[str, Any]:
        resp = await self._client.chat.completions.create(
            model=self._model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            response_format={
                "type": "json_schema",
                "json_schema": {"name": schema_name, "strict": True, "schema": schema},
            },
        )
        return json.loads(resp.choices[0].message.content)
