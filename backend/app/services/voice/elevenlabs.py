"""ElevenLabs low-latency TTS for the voice copilot.

available() lets the API tell the frontend whether to stream natural ElevenLabs
audio or fall back to the browser's Web Speech API on the same script — so the
voice demo works today and upgrades to ElevenLabs the moment a key is set.
"""

import httpx

from app.core.config import get_settings


def available() -> bool:
    return bool(get_settings().elevenlabs_api_key)


async def synthesize(text: str) -> bytes:
    """Return MP3 audio for the given text via ElevenLabs streaming TTS."""
    settings = get_settings()
    if not settings.elevenlabs_api_key:
        raise RuntimeError("ELEVENLABS_API_KEY not configured")

    url = f"https://api.elevenlabs.io/v1/text-to-speech/{settings.elevenlabs_voice_id}"
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            url,
            headers={
                "xi-api-key": settings.elevenlabs_api_key,
                "accept": "audio/mpeg",
                "content-type": "application/json",
            },
            json={
                "text": text,
                "model_id": settings.elevenlabs_model,
                "voice_settings": {"stability": 0.4, "similarity_boost": 0.75, "style": 0.15},
            },
        )
        resp.raise_for_status()
        return resp.content
