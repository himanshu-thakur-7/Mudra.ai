"""Review orchestration: deterministic checks -> retrieval -> reviewer ->
adjudicator -> clause-ID validation -> rewriter, with every stage journaled
to the audit trail.

Citation integrity: a finding can only surface with a clause_id that exists in
the clause registry; anything else is stripped here regardless of what the
LLM returned, and the strip itself is recorded in the audit trail.
"""

import hashlib

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AuditEvent, Clause, CorpusDoc, Finding, Review
from app.services.agents.llm import LLMClient
from app.services.grouping import category_for_tags
from app.services.agents.pipeline import (
    LLMFinding,
    run_adjudicator,
    run_reviewer,
    run_rewriter,
)
from app.services.checks.deterministic import run_deterministic_checks
from app.services.retrieval.store import get_store

SEVERITY_RANK = {"critical": 0, "major": 1, "minor": 2}


def _audit(db: Session, review_id: str, stage: str, payload: dict) -> None:
    db.add(AuditEvent(review_id=review_id, stage=stage, payload=payload))
    db.flush()


def _load_clause_meta(db: Session) -> dict[str, dict]:
    """clause_id -> full provenance (verbatim text, tags, page, doc URL/title/status)."""
    doc_rows = {
        d.id: d
        for d in db.scalars(select(CorpusDoc)).all()
    }
    meta: dict[str, dict] = {}
    for c in db.scalars(select(Clause)).all():
        doc = doc_rows.get(c.doc_id)
        meta[c.id] = {
            "text": c.text,
            "tags": c.tags or [],
            "status": c.status or "ACTIVE",
            "source_page": getattr(c, "source_page", None),
            "regulator": doc.regulator if doc else "",
            "doc_title": doc.title if doc else "",
            "source_url": doc.source_url if doc else "",
        }
    return meta


def _compute_verdict(severities: list[str]) -> str:
    if "critical" in severities:
        return "fail"
    if severities:
        return "needs_changes"
    return "pass"


def _dedupe(llm_findings: list[LLMFinding], det_keys: set[tuple[str, str]]) -> list[LLMFinding]:
    """Drop LLM findings that restate a deterministic finding (same clause,
    both 'missing disclosure'-style or overlapping quoted span)."""
    out = []
    for f in llm_findings:
        key = (f.clause_id, "missing" if f.offending_text.strip().startswith("(") else f.offending_text[:40].lower())
        det_missing = (f.clause_id, "missing") in det_keys
        if key in det_keys or (det_missing and f.offending_text.strip().startswith("(")):
            continue
        out.append(f)
    return out


async def run_review(
    db: Session,
    *,
    org_id: str,
    user_id: str | None,
    content: str,
    channel: str = "social",
    audience: str = "mfd",
    language: str = "en",
    arn_number: str | None = None,
    author_name: str | None = None,
) -> Review:
    review = Review(
        org_id=org_id,
        user_id=user_id,
        channel=channel,
        audience=audience,
        language=language,
        content=content,
        content_sha256=hashlib.sha256(content.encode()).hexdigest(),
        verdict="pending",
    )
    db.add(review)
    db.flush()
    _audit(db, review.id, "submitted", {"sha256": review.content_sha256, "channel": channel, "audience": audience})

    registry_ids = set(db.scalars(select(Clause.id)).all())
    clause_meta = _load_clause_meta(db)

    # 1. Deterministic checks — always run, zero-hallucination.
    det = run_deterministic_checks(content, audience=audience)
    _audit(db, review.id, "deterministic_checks", {"findings": [vars(f) for f in det]})
    det_keys = {
        (f.clause_id, "missing" if f.offending_text.strip().startswith("(") else f.offending_text[:40].lower())
        for f in det
    }

    llm_findings: list[LLMFinding] = []
    rewrite_data: dict[str, str] | None = None
    llm_error: str | None = None
    try:
        # 2. Retrieval — audience-filtered, mandatory clauses unioned in.
        store = get_store(db)
        retrieved = await store.search(content, audience=audience)
        _audit(
            db, review.id, "retrieval",
            {"clauses": [{"id": c.id, "score": c.score, "mandatory": c.mandatory} for c in retrieved]},
        )
        clauses_by_id = {c.id: c for c in retrieved}

        # 3. Reviewer agent.
        llm = LLMClient()
        already = [f"[{f.clause_id}] {f.explanation}" for f in det]
        raw_findings = await run_reviewer(llm, content, audience, channel, retrieved, already)
        _audit(db, review.id, "reviewer", {"findings": [f.raw for f in raw_findings]})

        # 4. Server-side citation validation BEFORE adjudication.
        valid, stripped = [], []
        for f in raw_findings:
            (valid if f.clause_id in registry_ids else stripped).append(f)
        if stripped:
            _audit(db, review.id, "citation_validation",
                   {"stripped": [{"clause_id": f.clause_id, "offending_text": f.offending_text} for f in stripped]})

        # 5. Adjudicator agent re-verifies each surviving finding.
        adjudicated = await run_adjudicator(llm, content, valid, clauses_by_id)
        _audit(
            db, review.id, "adjudicator",
            {"kept": [{"clause_id": f.clause_id, "adjudication": f.adjudication,
                       "severity": f.severity, "confidence": f.confidence} for f in adjudicated],
             "dropped": len(valid) - len(adjudicated)},
        )
        llm_findings = _dedupe(adjudicated, det_keys)
    except Exception as e:  # LLM outage degrades to deterministic-only review
        llm_error = f"{type(e).__name__}: {e}"
        _audit(db, review.id, "llm_error", {"error": llm_error})

    all_severities = [f.severity for f in det] + [f.severity for f in llm_findings]
    verdict = _compute_verdict(all_severities)

    # 6. Rewriter — only when something needs fixing and the LLM is available.
    if verdict != "pass" and llm_error is None:
        try:
            descs = [f"{f.explanation} (clause {f.clause_id})" for f in det] + [
                f"{f.explanation} (clause {f.clause_id})" for f in llm_findings
            ]
            rewrite_data = await run_rewriter(
                LLMClient(), content, audience, descs, arn_number, author_name
            )
            _audit(db, review.id, "rewriter", {"summary": rewrite_data["summary"]})
        except Exception as e:
            _audit(db, review.id, "rewriter_error", {"error": f"{type(e).__name__}: {e}"})

    def _provenance(clause_id: str | None, offending_text: str) -> dict:
        m = clause_meta.get(clause_id or "", {})
        # A structural absence is always a "missing disclosures" issue, whatever
        # other tags the cited clause happens to carry.
        is_missing = (offending_text or "").strip().startswith("(")
        issue_key = "missing_disclosures" if is_missing else category_for_tags(m.get("tags", []))
        return {
            "clause_quote": m.get("text", ""),
            "regulator": m.get("regulator", ""),
            "doc_title": m.get("doc_title", ""),
            "source_page": m.get("source_page"),
            "source_url": m.get("source_url", ""),
            "doc_status": m.get("status", "ACTIVE"),
            "issue_key": issue_key,
        }

    for f in det:
        db.add(Finding(
            review_id=review.id, source="deterministic", severity=f.severity,
            severity_rank=SEVERITY_RANK[f.severity], clause_id=f.clause_id,
            offending_text=f.offending_text,
            explanation=f.explanation, suggested_fix=f.suggested_fix,
            **_provenance(f.clause_id, f.offending_text),
        ))
    for f in llm_findings:
        db.add(Finding(
            review_id=review.id, source="llm", severity=f.severity,
            severity_rank=SEVERITY_RANK[f.severity], clause_id=f.clause_id,
            offending_text=f.offending_text,
            explanation=f.explanation, suggested_fix=f.suggested_fix,
            adjudication=f.adjudication, confidence=f.confidence,
            **_provenance(f.clause_id, f.offending_text),
        ))

    n_crit = sum(1 for s in all_severities if s == "critical")
    n_major = sum(1 for s in all_severities if s == "major")
    n_minor = sum(1 for s in all_severities if s == "minor")
    counts = ", ".join(
        p for p in [
            f"{n_crit} critical" if n_crit else "",
            f"{n_major} major" if n_major else "",
            f"{n_minor} minor" if n_minor else "",
        ] if p
    ) or "no issues"
    review.verdict = "error" if (llm_error and not all_severities) else verdict
    review.summary = (rewrite_data or {}).get("summary") or (
        f"Deterministic-only review ({llm_error})" if llm_error else f"Found {counts}."
    )
    review.rewrite = (rewrite_data or {}).get("rewrite")

    _audit(db, review.id, "verdict", {"verdict": review.verdict, "counts": counts, "llm_error": llm_error})
    db.commit()
    db.refresh(review)
    return review
