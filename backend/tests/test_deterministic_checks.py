"""Golden set for the deterministic checks layer — exact clause-ID assertions."""

from app.services.checks.deterministic import run_deterministic_checks

COMPLIANT_MFD = """Thinking about starting your investment journey? Happy to explain how SIPs work.
Ramesh Kumar — ARN-45678
AMFI-registered Mutual Fund Distributor
Mutual fund investments are subject to market risks. Read all scheme related documents carefully before investing."""

COMPLIANT_IA = """We publish research on Indian equities. Visit our site to learn about our process.
Alpha Research, SEBI Registration No. INH000012345
Investment in securities market are subject to market risks. Read all the related documents carefully before investing.
Registration granted by SEBI, membership of BASL and certification from NISM in no way guarantee performance of the intermediary or provide any assurance of returns to investors."""


def clause_ids(content: str, audience: str = "mfd") -> set[str]:
    return {f.clause_id for f in run_deterministic_checks(content, audience=audience)}


def test_compliant_mfd_post_has_no_findings():
    assert clause_ids(COMPLIANT_MFD) == set()


def test_compliant_ia_ad_has_no_findings():
    assert clause_ids(COMPLIANT_IA, audience="ia-ra") == set()


def test_missing_arn_flagged():
    content = COMPLIANT_MFD.replace("ARN-45678", "")
    assert "AMFI-MASTERCIR-2026/1.3.6" in clause_ids(content)


def test_missing_tagline_flagged():
    content = COMPLIANT_MFD.replace("AMFI-registered Mutual Fund Distributor", "")
    assert "AMFI-COC-2022/5.g" in clause_ids(content)


def test_missing_risk_warning_flagged():
    content = COMPLIANT_MFD.replace(
        "Mutual fund investments are subject to market risks. Read all scheme related documents carefully before investing.",
        "",
    )
    assert "AMFI-COC-2022/4.b" in clause_ids(content)


def test_guaranteed_returns_critical_mfd():
    findings = run_deterministic_checks(COMPLIANT_MFD + "\nGuaranteed wealth creation!", "mfd")
    hits = [f for f in findings if f.clause_id == "AMFI-COC-2022/4.g"]
    assert hits and all(f.severity == "critical" for f in hits)


def test_return_figure_flagged():
    assert "AMFI-COC-2022/4.g" in clause_ids(COMPLIANT_MFD + "\nEarn 12% returns every year!")


def test_superlative_flagged_mfd_cites_amfi():
    ids = clause_ids(COMPLIANT_MFD + "\nWe are the No.1 distributor in Pune!")
    assert "AMFI-COC-2022/4.b" in ids
    assert "SEBI-ADCODE-2023/1.c.xiii" not in ids  # no cross-audience citation


def test_superlative_flagged_ia_cites_sebi():
    ids = clause_ids(COMPLIANT_IA + "\nWe are the best research analysts in India.", audience="ia-ra")
    assert "SEBI-ADCODE-2023/1.c.xiii" in ids


def test_financial_planner_term_flagged_for_mfd():
    assert "AMFI-DOSDONTS-FAQ/Q2" in clause_ids(COMPLIANT_MFD + "\nI offer complete financial planning.")


def test_free_portfolio_review_flagged():
    assert "AMFI-DOSDONTS-FAQ/Q8.c" in clause_ids(COMPLIANT_MFD + "\nDM for a free portfolio review!")


def test_riskfree_critical_ia():
    findings = run_deterministic_checks(
        COMPLIANT_IA + "\nOur calls generate risk-free profits.", "ia-ra"
    )
    hits = [f for f in findings if f.clause_id == "SEBI-ADCODE-2023/1.c.x"]
    assert hits and all(f.severity == "critical" for f in hits)


def test_missing_standard_warning_ia():
    content = COMPLIANT_IA.replace(
        "Investment in securities market are subject to market risks. Read all the related documents carefully before investing.",
        "",
    )
    assert "SEBI-ADCODE-2023/1.b.iii" in clause_ids(content, audience="ia-ra")


def test_hinglish_guarantee_flagged():
    assert "AMFI-COC-2022/4.g" in clause_ids(COMPLIANT_MFD + "\nPakka returns milenge!")
