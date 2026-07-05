from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.db import get_db
from app.models import Review, User
from app.schemas import ReviewCreate, ReviewListItem, ReviewOut

router = APIRouter(prefix="/reviews", tags=["reviews"])


@router.post("", response_model=ReviewOut)
async def create_review(
    body: ReviewCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from app.services.review_service import run_review

    review = await run_review(
        db,
        org_id=user.org_id,
        user_id=user.id,
        content=body.content,
        channel=body.channel,
        audience=body.audience,
        language=body.language,
        arn_number=user.arn_number,
        author_name=user.name,
    )
    return review


@router.get("", response_model=list[ReviewListItem])
def list_reviews(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    reviews = db.scalars(
        select(Review).where(Review.org_id == user.org_id).order_by(Review.created_at.desc())
    ).all()
    return [
        ReviewListItem(
            id=r.id,
            channel=r.channel,
            verdict=r.verdict,
            summary=r.summary,
            created_at=r.created_at,
            content_preview=r.content[:140],
        )
        for r in reviews
    ]


@router.get("/{review_id}", response_model=ReviewOut)
def get_review(
    review_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    review = db.get(Review, review_id)
    if not review or review.org_id != user.org_id:
        raise HTTPException(status_code=404, detail="Review not found")
    return review
