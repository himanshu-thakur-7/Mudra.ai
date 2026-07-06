"""Golden set for the Stage-3 audiences: digital lending (RBI) and insurance (IRDAI)."""

from app.services.checks.deterministic import run_deterministic_checks

COMPLIANT_LOAN = """Personal loans from ABC Finance Ltd (RBI-registered NBFC).
Interest from 14% per annum — APR and all charges shown upfront in your Key Facts Statement before you sign.
Subject to credit assessment. T&C apply."""

COMPLIANT_INSURANCE = """Protect your family with the SecureLife term insurance plan from XYZ Life Insurance Co. Ltd.
IRDAI Regn. No. 123. Benefits are as per policy terms; please read the sales brochure carefully.
Exclusions and waiting periods apply."""


def ids(content: str, audience: str) -> set[str]:
    return {f.clause_id for f in run_deterministic_checks(content, audience=audience)}


def sev(content: str, audience: str, clause_id: str) -> list[str]:
    return [f.severity for f in run_deterministic_checks(content, audience) if f.clause_id == clause_id]


# ---- nbfc-lsp ----

def test_compliant_loan_ad_passes():
    assert ids(COMPLIANT_LOAN, "nbfc-lsp") == set()


def test_guaranteed_approval_critical():
    assert sev("Guaranteed approval for everyone! Apply today.", "nbfc-lsp", "RBI-DLD-2025/6.iv") == ["critical"]


def test_no_credit_check_flagged():
    assert "RBI-DLD-2025/6.iv" in ids("Get cash today — no credit check needed!", "nbfc-lsp")


def test_rate_without_apr_flagged():
    found = ids("Loans at just 1.5% per month!", "nbfc-lsp")
    assert "RBI-DLD-2025/6.iii" in found       # rate without APR
    assert "RBI-DLD-2025/8.i" in found          # no KFS reference


def test_rate_with_apr_and_kfs_not_flagged():
    found = ids("Loans at 18% per annum (APR 19.2%). Full details in your Key Facts Statement.", "nbfc-lsp")
    assert "RBI-DLD-2025/6.iii" not in found and "RBI-DLD-2025/8.i" not in found


def test_urgency_dark_pattern_flagged():
    assert "RBI-DLD-2025/6.iv" in ids(COMPLIANT_LOAN + "\nOnly 10 slots left!", "nbfc-lsp")


# ---- insurance ----

def test_compliant_insurance_ad_passes():
    assert ids(COMPLIANT_INSURANCE, "insurance") == set()


def test_guaranteed_bonus_critical():
    assert "critical" in sev(
        COMPLIANT_INSURANCE + "\nGuaranteed bonus of ₹10 lakh on maturity!", "insurance",
        "IRDAI-ADREG-2021/3.g",
    )


def test_irdai_endorsement_flagged():
    assert "IRDAI-ADREG-2021/3.g" in ids(COMPLIANT_INSURANCE + "\nAn IRDAI-approved plan you can trust.", "insurance")


def test_product_not_identified_as_insurance():
    content = "SecureLife gives your family ₹1 crore protection. XYZ Co. IRDAI Regn. No. 123."
    found = ids(content, "insurance")
    assert "IRDAI-ADREG-2021/3.g" in found


def test_missing_registration_number_minor():
    content = COMPLIANT_INSURANCE.replace("IRDAI Regn. No. 123. ", "")
    assert sev(content, "insurance", "IRDAI-ADREG-2021/9.1") == ["minor"]
