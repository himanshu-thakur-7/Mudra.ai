"""Live-LLM golden tests (RUN_LLM_TESTS=1). Assertions are clause-ID membership,
tolerant to wording — the LLM's phrasing varies, its citations must not."""

import pytest

from app.services.review_service import run_review

pytestmark = pytest.mark.llm

COMPLIANT = """Namaste! I'm hosting a free-to-attend webinar on how SIPs and compounding work.
No product pitches — just investor education.
Meena Iyer — ARN-77777
AMFI-registered Mutual Fund Distributor
Mutual fund investments are subject to market risks. Read all scheme related documents carefully before investing."""

SCHEME_PUSH = """XYZ Flexicap gave 32% last year — my clients are loving it! 📈
Join before the NFO closes. Meena Iyer — ARN-77777
AMFI-registered Mutual Fund Distributor
Mutual fund investments are subject to market risks. Read all scheme related documents carefully before investing."""


async def test_compliant_educational_post_passes(db, seeded_user):
    review = await run_review(
        db, org_id=seeded_user.org_id, user_id=seeded_user.id,
        content=COMPLIANT, channel="whatsapp", audience="mfd",
        arn_number="ARN-77777", author_name="Meena Iyer",
    )
    assert review.verdict == "pass", [
        (f.clause_id, f.explanation) for f in review.findings
    ]


async def test_scheme_performance_push_flagged(db, seeded_user):
    review = await run_review(
        db, org_id=seeded_user.org_id, user_id=seeded_user.id,
        content=SCHEME_PUSH, channel="social", audience="mfd",
        arn_number="ARN-77777", author_name="Meena Iyer",
    )
    assert review.verdict in ("needs_changes", "fail")
    ids = {f.clause_id for f in review.findings}
    # past-performance/scheme-specific social content: any of these citations is correct
    assert ids & {
        "AMFI-DOSDONTS-FAQ/Q9", "AMFI-DOSDONTS-FAQ/Q10", "AMFI-DOSDONTS-FAQ/Q13",
        "AMFI-COC-2022/4.k", "AMFI-COC-2022/4.g", "AMFI-COC-2022/2.a",
    }, ids
    assert review.rewrite
    # rewrite must keep identity + not invent a name
    assert "Meena Iyer" in review.rewrite and "ARN-77777" in review.rewrite
