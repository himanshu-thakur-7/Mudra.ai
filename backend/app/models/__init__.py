import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, Float, ForeignKey, LargeBinary, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


def _uuid() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Org(Base):
    __tablename__ = "orgs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200))
    # Entitlement seam for Stage 2/3 pricing tiers; unused by MVP logic.
    plan: Mapped[str] = mapped_column(String(50), default="self-serve")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    users: Mapped[list["User"]] = relationship(back_populates="org")


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    org_id: Mapped[str] = mapped_column(ForeignKey("orgs.id"))
    email: Mapped[str] = mapped_column(String(320), unique=True)
    name: Mapped[str] = mapped_column(String(200), default="")
    # MFD ARN / RIA registration number, used to personalise rewrites.
    arn_number: Mapped[str | None] = mapped_column(String(50), nullable=True)
    whatsapp_number: Mapped[str | None] = mapped_column(String(30), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    org: Mapped[Org] = relationship(back_populates="users")


class CorpusDoc(Base):
    __tablename__ = "corpus_docs"

    id: Mapped[str] = mapped_column(String(100), primary_key=True)  # e.g. SEBI-ADCODE-2023
    regulator: Mapped[str] = mapped_column(String(20), index=True)  # SEBI | AMFI | RBI | IRDAI
    title: Mapped[str] = mapped_column(String(500))
    source_url: Mapped[str] = mapped_column(String(1000), default="")
    source_file: Mapped[str] = mapped_column(String(500), default="")
    effective_date: Mapped[str] = mapped_column(String(20), default="")  # ISO date string
    ingested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    clauses: Mapped[list["Clause"]] = relationship(back_populates="doc")


class Clause(Base):
    __tablename__ = "clauses"

    # Stable citation ID, e.g. "SEBI-ADCODE-2023/4.2"
    id: Mapped[str] = mapped_column(String(150), primary_key=True)
    doc_id: Mapped[str] = mapped_column(ForeignKey("corpus_docs.id"), index=True)
    clause_number: Mapped[str] = mapped_column(String(50))
    text: Mapped[str] = mapped_column(Text)
    tags: Mapped[list] = mapped_column(JSON, default=list)  # e.g. ["performance-claims"]
    # Clauses tagged mandatory are always included in the retrieval set.
    mandatory: Mapped[bool] = mapped_column(default=False)
    embedding: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)  # float32 numpy bytes

    doc: Mapped[CorpusDoc] = relationship(back_populates="clauses")


class Review(Base):
    __tablename__ = "reviews"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    org_id: Mapped[str] = mapped_column(ForeignKey("orgs.id"), index=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    channel: Mapped[str] = mapped_column(String(20), default="social")  # whatsapp|social|email|web
    language: Mapped[str] = mapped_column(String(10), default="en")
    content: Mapped[str] = mapped_column(Text)
    content_sha256: Mapped[str] = mapped_column(String(64))
    verdict: Mapped[str] = mapped_column(String(20), default="pending")  # pass|needs_changes|fail|error|pending
    rewrite: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)

    findings: Mapped[list["Finding"]] = relationship(back_populates="review", order_by="Finding.severity_rank")
    audit_events: Mapped[list["AuditEvent"]] = relationship(back_populates="review", order_by="AuditEvent.created_at")


class Finding(Base):
    __tablename__ = "findings"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    review_id: Mapped[str] = mapped_column(ForeignKey("reviews.id"), index=True)
    source: Mapped[str] = mapped_column(String(20))  # deterministic | llm
    severity: Mapped[str] = mapped_column(String(20))  # critical | major | minor
    severity_rank: Mapped[int] = mapped_column(default=99)  # 0=critical for stable ordering
    clause_id: Mapped[str | None] = mapped_column(ForeignKey("clauses.id"), nullable=True)
    clause_quote: Mapped[str] = mapped_column(Text, default="")  # verbatim, attached server-side
    offending_text: Mapped[str] = mapped_column(Text, default="")
    explanation: Mapped[str] = mapped_column(Text, default="")
    suggested_fix: Mapped[str] = mapped_column(Text, default="")
    adjudication: Mapped[str] = mapped_column(String(20), default="upheld")  # upheld|downgraded|dropped
    confidence: Mapped[float] = mapped_column(Float, default=1.0)

    review: Mapped[Review] = relationship(back_populates="findings")


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    review_id: Mapped[str] = mapped_column(ForeignKey("reviews.id"), index=True)
    stage: Mapped[str] = mapped_column(String(50))  # submitted|deterministic_checks|retrieval|reviewer|adjudicator|rewriter|verdict
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    review: Mapped[Review] = relationship(back_populates="audit_events")
