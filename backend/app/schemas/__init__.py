from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Channel = Literal["whatsapp", "social", "email", "web"]
Audience = Literal["mfd", "ia-ra", "nbfc-lsp", "insurance"]
Verdict = Literal["pass", "needs_changes", "fail", "error", "pending"]
Severity = Literal["critical", "major", "minor"]


class ReviewCreate(BaseModel):
    content: str = Field(min_length=1, max_length=20000)
    channel: Channel = "social"
    audience: Audience = "mfd"
    language: str = "en"


class FindingOut(BaseModel):
    id: str
    source: str
    severity: Severity
    clause_id: str | None
    clause_quote: str
    offending_text: str
    explanation: str
    suggested_fix: str
    adjudication: str
    confidence: float

    model_config = {"from_attributes": True}


class ClauseCitationOut(BaseModel):
    clause_id: str
    clause_quote: str
    regulator: str
    doc_title: str
    source_page: int | None
    source_url: str
    doc_status: str


class OffendingSpanOut(BaseModel):
    text: str
    explanation: str
    source: str
    confidence: float


class IssueOut(BaseModel):
    """A synthesized, adjudicated issue — the product-facing unit. Overlapping
    atomic findings are collapsed here; each issue cites its clauses once."""
    key: str
    title: str
    blurb: str
    severity: Severity
    citations: list[ClauseCitationOut]
    spans: list[OffendingSpanOut]
    missing_requirements: list[str]


class ReviewOut(BaseModel):
    id: str
    channel: str
    audience: str
    language: str
    content: str
    content_sha256: str
    verdict: Verdict
    rewrite: str | None
    summary: str
    created_at: datetime
    issues: list[IssueOut]
    findings: list[FindingOut]  # atomic rows, retained for the audit trail

    model_config = {"from_attributes": True}


class ReviewListItem(BaseModel):
    id: str
    channel: str
    verdict: Verdict
    summary: str
    created_at: datetime
    content_preview: str


class ClauseOut(BaseModel):
    id: str
    doc_id: str
    clause_number: str
    text: str
    tags: list
    mandatory: bool

    model_config = {"from_attributes": True}
