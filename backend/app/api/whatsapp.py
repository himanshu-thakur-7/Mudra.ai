"""Twilio WhatsApp inbound webhook.

Configure the Twilio sandbox 'when a message comes in' URL to
POST {public_backend_url}/webhooks/whatsapp (use ngrok for local dev).
Replies use TwiML so no outbound API call/credentials are required for the MVP.
"""

from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.auth import seed_default_user
from app.core.config import get_settings
from app.core.db import get_db

router = APIRouter(prefix="/webhooks", tags=["whatsapp"])


async def _verify_twilio_signature(request: Request) -> None:
    """Reject requests not signed by Twilio. Skipped when no auth token is
    configured (local dev / tests) — set TWILIO_AUTH_TOKEN in any deployment."""
    settings = get_settings()
    if not settings.twilio_auth_token:
        return
    from twilio.request_validator import RequestValidator

    validator = RequestValidator(settings.twilio_auth_token)
    form = await request.form()
    signature = request.headers.get("X-Twilio-Signature", "")
    if not validator.validate(str(request.url), dict(form), signature):
        raise HTTPException(status_code=403, detail="Invalid Twilio signature")


@router.post("/whatsapp")
async def whatsapp_inbound(
    request: Request,
    Body: str = Form(default=""),
    From: str = Form(default=""),
    db: Session = Depends(get_db),
):
    await _verify_twilio_signature(request)
    from app.services.review_service import run_review
    from app.services.whatsapp.format import format_whatsapp_reply, twiml_message

    settings = get_settings()
    text = Body.strip()
    if not text:
        return Response(
            content=twiml_message("Send me a marketing post/ad text and I'll pre-check it against SEBI/AMFI rules."),
            media_type="application/xml",
        )

    # Sandbox MVP: all WhatsApp traffic maps to the seeded demo user.
    user = seed_default_user(db)
    review = await run_review(
        db,
        org_id=user.org_id,
        user_id=user.id,
        content=text,
        channel="whatsapp",
        language="en",
        arn_number=user.arn_number,
        author_name=user.name,
    )
    reply = format_whatsapp_reply(review, settings.public_web_url)
    return Response(content=twiml_message(reply), media_type="application/xml")
