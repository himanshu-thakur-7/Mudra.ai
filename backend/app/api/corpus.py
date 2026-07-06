from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.auth import get_current_user
from app.core.db import get_db
from app.models import Clause, CorpusChangeEvent, CorpusDoc, User
from app.schemas import ClauseOut

router = APIRouter(prefix="/corpus", tags=["corpus"])


@router.get("/changes")
def list_changes(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Regulatory change feed produced by the ingestion fleet + consumer."""
    events = db.scalars(
        select(CorpusChangeEvent).order_by(CorpusChangeEvent.created_at.desc()).limit(50)
    ).all()
    return [
        {
            "id": e.id,
            "regulator": e.regulator,
            "url": e.url,
            "n_chunks": e.n_chunks,
            "extraction_method": e.extraction_method,
            "status": e.status,
            "created_at": e.created_at,
        }
        for e in events
    ]


@router.get("/docs")
def list_docs(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    docs = db.scalars(select(CorpusDoc)).all()
    return [
        {
            "id": d.id,
            "regulator": d.regulator,
            "title": d.title,
            "source_url": d.source_url,
            "effective_date": d.effective_date,
            "clause_count": len(d.clauses),
        }
        for d in docs
    ]


@router.get("/clauses", response_model=list[ClauseOut])
def list_clauses(
    doc_id: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = select(Clause)
    if doc_id:
        q = q.where(Clause.doc_id == doc_id)
    return db.scalars(q).all()
