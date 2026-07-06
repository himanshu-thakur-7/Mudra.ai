"""Synthesis layer: overlapping atomic findings collapse into adjudicated
issue groups with deduped clauses and spans."""

from types import SimpleNamespace

from app.services.grouping import category_for_tags, group_findings


def _finding(**kw):
    base = dict(
        source="llm", severity="major", clause_id="X/1", clause_quote="q",
        offending_text="", explanation="", suggested_fix="", adjudication="upheld",
        confidence=1.0, regulator="AMFI", doc_title="Doc", source_page=3,
        source_url="https://x", doc_status="ACTIVE", issue_key="other",
    )
    base.update(kw)
    return SimpleNamespace(**base)


def test_three_guaranteed_flags_collapse_to_one_issue():
    findings = [
        _finding(severity="critical", clause_id="AMFI-COC-2022/4.g", issue_key="assured_returns",
                 offending_text="guaranteed way to beat inflation", explanation="e1"),
        _finding(severity="critical", clause_id="AMFI-COC-2022/4.g", issue_key="assured_returns",
                 offending_text="sure-shot gains", explanation="e2"),
        _finding(severity="critical", clause_id="AMFI-COC-2022/4.g", issue_key="assured_returns",
                 offending_text="guaranteed", explanation="e3"),
    ]
    issues = group_findings(findings)
    assert len(issues) == 1
    issue = issues[0]
    assert issue.title == "Assured / guaranteed returns"
    assert issue.severity == "critical"
    assert len(issue.citations) == 1  # clause cited ONCE
    assert issue.citations[0].clause_id == "AMFI-COC-2022/4.g"
    assert {s.text for s in issue.spans} == {"guaranteed way to beat inflation", "sure-shot gains", "guaranteed"}


def test_same_phrase_two_clauses_dedupes_span_keeps_both_citations():
    phrase = "you need to put your money into the Nippon India Small Cap Fund today"
    findings = [
        _finding(clause_id="AMFI-DOSDONTS-FAQ/Q9", issue_key="scheme_specific", offending_text=phrase),
        _finding(clause_id="AMFI-DOSDONTS-FAQ/Q10", issue_key="scheme_specific", offending_text=phrase),
    ]
    issues = group_findings(findings)
    assert len(issues) == 1
    issue = issues[0]
    assert len(issue.spans) == 1  # phrase shown once
    assert {c.clause_id for c in issue.citations} == {"AMFI-DOSDONTS-FAQ/Q9", "AMFI-DOSDONTS-FAQ/Q10"}


def test_missing_disclosures_become_requirement_chips():
    findings = [
        _finding(source="deterministic", clause_id="AMFI-MASTERCIR-2026/1.3.6", issue_key="missing_disclosures",
                 offending_text="(ARN number not found in content)", explanation="No ARN code found"),
        _finding(source="deterministic", clause_id="AMFI-COC-2022/5.g", issue_key="missing_disclosures",
                 offending_text="(mandatory tagline not found)", explanation="The mandatory tagline must appear"),
        _finding(source="deterministic", clause_id="AMFI-COC-2022/4.b", issue_key="missing_disclosures",
                 offending_text="(risk disclosure not found)", explanation="No market-risk warning found"),
    ]
    issues = group_findings(findings)
    assert len(issues) == 1
    issue = issues[0]
    assert issue.title == "Missing mandatory disclosures"
    assert issue.spans == []  # absences are not highlighted spans
    assert "ARN code" in issue.missing_requirements
    assert any("tagline" in r for r in issue.missing_requirements)
    assert any("risk" in r for r in issue.missing_requirements)


def test_category_mapping():
    assert category_for_tags(["assured-returns"]) == "assured_returns"
    assert category_for_tags(["tagline-arn"]) == "missing_disclosures"
    assert category_for_tags(["scheme-marketing", "past-performance"]) == "scheme_specific"
    assert category_for_tags(["unknown"]) == "other"


def test_severity_is_max_across_group():
    findings = [
        _finding(severity="minor", issue_key="assured_returns", offending_text="a"),
        _finding(severity="critical", issue_key="assured_returns", offending_text="b"),
    ]
    assert group_findings(findings)[0].severity == "critical"
