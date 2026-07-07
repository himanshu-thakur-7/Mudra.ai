"""Voice copilot API — the demo hero.

- GET /api/reviews/{id}/narration : the spoken briefing as text + segments,
  plus whether ElevenLabs natural voice is available. The frontend plays
  ElevenLabs audio when available, else speaks the script with the browser's
  Web Speech API (so the voice demo always works).
- GET /api/reviews/{id}/voice.mp3 : streamed ElevenLabs audio of the briefing.
"""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.db import get_db
from app.models import Review, User
from app.services.voice import elevenlabs
from app.services.voice.narration import build_narration

router = APIRouter(prefix="/reviews", tags=["voice"])


def _load(review_id: str, db: Session, user: User) -> Review:
    review = db.get(Review, review_id)
    if not review or review.org_id != user.org_id:
        raise HTTPException(status_code=404, detail="Review not found")
    return review


@router.get("/{review_id}/narration")
def narration(review_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    review = _load(review_id, db, user)
    script, segments = build_narration(review)
    return {
        "script": script,
        "segments": [{"kind": s.kind, "label": s.label, "text": s.text} for s in segments],
        "tts": "elevenlabs" if elevenlabs.available() else "browser",
        "voice_available": elevenlabs.available(),
    }


@router.get("/{review_id}/voice.mp3")
async def voice_mp3(review_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    review = _load(review_id, db, user)
    if not elevenlabs.available():
        raise HTTPException(status_code=501, detail="ElevenLabs not configured; frontend falls back to browser speech")
    script, _ = build_narration(review)
    audio = await elevenlabs.synthesize(script)
    return Response(content=audio, media_type="audio/mpeg",
                    headers={"Content-Disposition": f'inline; filename="briefing-{review.id[:8]}.mp3"'})
