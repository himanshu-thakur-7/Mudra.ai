"""Review-service tests with the LLM mocked — pipeline mechanics, citation
integrity, verdict logic. Live-LLM golden tests live in test_llm_golden.py."""

import pytest

import app.services.review_service as rs
from app.services.agents.pipeline import LLMFinding

NON_COMPLIANT = "Guaranteed 15% returns! Best fund ever. DM me."
COMPLIANT = """SIP basics session this Saturday — all welcome.
Meena Iyer — ARN-77777
AMFI-registered Mutual Fund Distributor
Mutual fund investments are subject to market risks. Read all scheme related documents carefully before investing."""


@pytest.fixture()
def mocked_llm(monkeypatch):
    """Neutralise all LLM calls; individual tests override what they need."""

    async def fake_reviewer(llm, content, audience, channel, clauses, already):
        return []

    async def fake_adjudicator(llm, content, findings, clauses_by_id):
        return findings  # uphold everything

    async def fake_rewriter(llm, content, audience, descs, arn, author_name=None):
        return {"rewrite": "compliant version", "summary": "issues fixed"}

    monkeypatch.setattr(rs, "run_reviewer", fake_reviewer)
    monkeypatch.setattr(rs, "run_adjudicator", fake_adjudicator)
    monkeypatch.setattr(rs, "run_rewriter", fake_rewriter)

    class FakeStore:
        async def search(self, query, audience, k=12):
            return []

    monkeypatch.setattr(rs, "get_store", lambda db: FakeStore())
    monkeypatch.setattr(rs, "LLMClient", lambda: None)
    return monkeypatch


async def test_non_compliant_fails_with_deterministic_findings(db, seeded_user, mocked_llm):
    review = await rs.run_review(
        db, org_id=seeded_user.org_id, user_id=seeded_user.id,
        content=NON_COMPLIANT, channel="whatsapp", audience="mfd",
    )
    assert review.verdict == "fail"
    ids = {f.clause_id for f in review.findings}
    assert "AMFI-COC-2022/4.g" in ids  # guaranteed/15% returns
    assert all(f.clause_quote for f in review.findings)  # verbatim quote attached
    assert review.rewrite == "compliant version"
    stages = [e.stage for e in review.audit_events]
    assert stages[0] == "submitted" and "verdict" in stages


async def test_compliant_passes_without_rewrite(db, seeded_user, mocked_llm):
    review = await rs.run_review(
        db, org_id=seeded_user.org_id, user_id=seeded_user.id,
        content=COMPLIANT, channel="whatsapp", audience="mfd",
    )
    assert review.verdict == "pass"
    assert review.findings == []
    assert review.rewrite is None


async def test_hallucinated_clause_id_is_stripped(db, seeded_user, mocked_llm, monkeypatch):
    async def hallucinating_reviewer(llm, content, audience, channel, clauses, already):
        return [
            LLMFinding(
                clause_id="SEBI-FAKE-9999/1.1", severity="critical",
                offending_text="DM me", explanation="made up", suggested_fix="n/a",
            ),
            LLMFinding(
                clause_id="AMFI-DOSDONTS-FAQ/Q9", severity="major",
                offending_text="Best fund ever", explanation="scheme performance claim on social media",
                suggested_fix="remove",
            ),
        ]

    monkeypatch.setattr(rs, "run_reviewer", hallucinating_reviewer)
    review = await rs.run_review(
        db, org_id=seeded_user.org_id, user_id=seeded_user.id,
        content=NON_COMPLIANT, channel="whatsapp", audience="mfd",
    )
    ids = {f.clause_id for f in review.findings}
    assert "SEBI-FAKE-9999/1.1" not in ids
    assert "AMFI-DOSDONTS-FAQ/Q9" in ids
    validation_events = [e for e in review.audit_events if e.stage == "citation_validation"]
    assert validation_events and validation_events[0].payload["stripped"][0]["clause_id"] == "SEBI-FAKE-9999/1.1"


async def test_llm_outage_degrades_to_deterministic_only(db, seeded_user, mocked_llm, monkeypatch):
    class ExplodingStore:
        async def search(self, query, audience, k=12):
            raise RuntimeError("API down")

    monkeypatch.setattr(rs, "get_store", lambda db: ExplodingStore())
    review = await rs.run_review(
        db, org_id=seeded_user.org_id, user_id=seeded_user.id,
        content=NON_COMPLIANT, channel="whatsapp", audience="mfd",
    )
    assert review.verdict == "fail"  # deterministic criticals still decide
    assert any(e.stage == "llm_error" for e in review.audit_events)
    assert review.rewrite is None


async def test_duplicate_llm_finding_deduped(db, seeded_user, mocked_llm, monkeypatch):
    async def duplicating_reviewer(llm, content, audience, channel, clauses, already):
        return [
            LLMFinding(  # duplicates the deterministic missing-tagline finding
                clause_id="AMFI-COC-2022/5.g", severity="major",
                offending_text="(missing: tagline)", explanation="tagline absent", suggested_fix="add",
            ),
        ]

    monkeypatch.setattr(rs, "run_reviewer", duplicating_reviewer)
    review = await rs.run_review(
        db, org_id=seeded_user.org_id, user_id=seeded_user.id,
        content=NON_COMPLIANT, channel="whatsapp", audience="mfd",
    )
    tagline_findings = [f for f in review.findings if f.clause_id == "AMFI-COC-2022/5.g"]
    assert len(tagline_findings) == 1
    assert tagline_findings[0].source == "deterministic"
