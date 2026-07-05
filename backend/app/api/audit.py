from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.db import get_db
from app.models import Review, User

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("/{review_id}/pdf")
def audit_pdf(
    review_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    review = db.get(Review, review_id)
    if not review or review.org_id != user.org_id:
        raise HTTPException(status_code=404, detail="Review not found")

    from app.services.audit.pdf import build_audit_pdf

    pdf_bytes = build_audit_pdf(review)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="audit-{review.id[:8]}.pdf"'
        },
    )
