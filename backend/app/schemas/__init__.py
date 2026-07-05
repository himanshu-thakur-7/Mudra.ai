from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Channel = Literal["whatsapp", "social", "email", "web"]
Audience = Literal["mfd", "ia-ra"]
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
    findings: list[FindingOut]

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
