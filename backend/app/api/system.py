"""Partner integration status — powers the 'stack' panel in the UI so a judge
can see every Buildathon partner is wired, and which are live vs key-ready."""

from fastapi import APIRouter, Depends

from app.core.auth import get_current_user
from app.core.config import get_settings
from app.models import User

router = APIRouter(prefix="/system", tags=["system"])


@router.get("/partners")
def partners(user: User = Depends(get_current_user)):
    s = get_settings()
    return {
        "agent_provider": s.agent_provider,  # hermes | openai (active right now)
        "partners": [
            {"key": "hermes", "name": "Nous Hermes", "role": "Core agent pipeline", "live": bool(s.hermes_api_key)},
            {"key": "openai", "name": "OpenAI GPT-5.5", "role": "Vision/OCR preprocessing", "live": bool(s.openai_api_key)},
            {"key": "convex", "name": "Convex", "role": "Realtime DB · vector search", "live": bool(s.convex_url)},
            {"key": "linkup", "name": "Linkup", "role": "Live regulatory search", "live": bool(s.linkup_api_key)},
            {"key": "cloudflare", "name": "Cloudflare AI Gateway", "role": "LLM routing · observability", "live": bool(s.cf_ai_gateway_base)},
            {"key": "elevenlabs", "name": "ElevenLabs", "role": "Voice copilot", "live": bool(s.elevenlabs_api_key)},
            {"key": "razorpay", "name": "Razorpay", "role": "UPI AutoPay subscription", "live": bool(s.razorpay_key_id)},
        ],
    }
