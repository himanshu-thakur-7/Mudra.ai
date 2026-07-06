"""Synthesis layer: turn a flat list of atomic findings into adjudicated
issue groups — the difference between a vector-search dump and a product.

Grouping is deterministic (no extra LLM latency / failure surface): every
finding carries an issue_key derived from its clause tags, so overlapping
flags collapse:

  - 3 separate "guaranteed returns" flags on AMFI-COC-2022/4.g -> ONE
    "Assured / guaranteed returns" issue, clause cited once, all spans listed.
  - Q9 + Q10 on the same offending phrase -> ONE "Scheme-specific
    recommendation" issue citing both clauses, phrase shown once.
  - ARN + tagline + risk-warning -> ONE "Missing mandatory disclosures" issue;
    the holistic rewrite is the remediation, not three piecemeal fixes.

The atomic Finding rows are still persisted for the courtroom audit trail;
only the presentation is synthesized.
"""

import re
from dataclasses import dataclass, field

# Clause tag -> issue category. First matching tag wins (order matters).
TAG_TO_CATEGORY: list[tuple[str, str]] = [
    ("assured-returns", "assured_returns"),
    ("benefit-claims", "assured_returns"),
    ("scheme-marketing", "scheme_specific"),
    ("past-performance", "scheme_specific"),
    ("superlatives", "misleading_exaggeration"),
    ("misleading-statements", "misleading_exaggeration"),
    ("comparisons", "misleading_exaggeration"),
    ("dark-patterns", "misleading_exaggeration"),
    ("financial-planning-terms", "prohibited_conduct"),
    ("nomenclature", "prohibited_conduct"),
    ("inducements", "prohibited_conduct"),
    ("free-services", "prohibited_conduct"),
    ("prior-approval", "prohibited_conduct"),
    ("tagline-arn", "missing_disclosures"),
    ("identity-disclosure", "missing_disclosures"),
    ("standard-warning", "missing_disclosures"),
    ("risk-disclosure", "missing_disclosures"),
    ("apr-kfs", "missing_disclosures"),
    ("disclaimers", "missing_disclosures"),
]

CATEGORY_META: dict[str, dict] = {
    "assured_returns": {
        "title": "Assured / guaranteed returns",
        "blurb": "Language that promises, guarantees or implies assured or risk-free returns.",
    },
    "scheme_specific": {
        "title": "Scheme-specific recommendation",
        "blurb": "Recommending a specific scheme or citing its performance to a public audience.",
    },
    "misleading_exaggeration": {
        "title": "Misleading or exaggerated claims",
        "blurb": "Superlatives, exaggeration or claims that could mislead investors.",
    },
    "prohibited_conduct": {
        "title": "Prohibited conduct / terminology",
        "blurb": "Advisory terminology, inducements or conduct an MFD/entity may not use.",
    },
    "missing_disclosures": {
        "title": "Missing mandatory disclosures",
        "blurb": "Required identity, tagline, registration or risk-warning elements are absent.",
    },
    "other": {"title": "Other compliance issue", "blurb": ""},
}

SEVERITY_RANK = {"critical": 0, "major": 1, "minor": 2}


def category_for_tags(tags: list[str]) -> str:
    for tag, cat in TAG_TO_CATEGORY:
        if tag in (tags or []):
            return cat
    return "other"


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().strip("\"'“”").lower())


@dataclass
class ClauseCitation:
    clause_id: str
    clause_quote: str
    regulator: str
    doc_title: str
    source_page: int | None
    source_url: str
    doc_status: str


@dataclass
class OffendingSpan:
    text: str
    explanation: str
    source: str  # deterministic | llm
    confidence: float


@dataclass
class Issue:
    key: str
    title: str
    blurb: str
    severity: str
    citations: list[ClauseCitation] = field(default_factory=list)
    spans: list[OffendingSpan] = field(default_factory=list)
    missing_requirements: list[str] = field(default_factory=list)  # for missing_disclosures


def group_findings(findings) -> list[Issue]:
    """`findings` is an iterable of ORM Finding rows (or duck-typed equivalents)."""
    buckets: dict[str, Issue] = {}
    seen_citations: dict[str, set] = {}
    seen_spans: dict[str, set] = {}

    # Stable order: criticals first, then by clause for determinism.
    ordered = sorted(findings, key=lambda f: (SEVERITY_RANK.get(f.severity, 9), f.clause_id or ""))

    for f in ordered:
        key = f.issue_key or "other"
        if key not in buckets:
            meta = CATEGORY_META.get(key, CATEGORY_META["other"])
            buckets[key] = Issue(key=key, title=meta["title"], blurb=meta["blurb"], severity=f.severity)
            seen_citations[key] = set()
            seen_spans[key] = set()
        issue = buckets[key]
        if SEVERITY_RANK.get(f.severity, 9) < SEVERITY_RANK.get(issue.severity, 9):
            issue.severity = f.severity

        if f.clause_id and f.clause_id not in seen_citations[key]:
            seen_citations[key].add(f.clause_id)
            issue.citations.append(ClauseCitation(
                clause_id=f.clause_id,
                clause_quote=f.clause_quote,
                regulator=f.regulator,
                doc_title=f.doc_title,
                source_page=f.source_page,
                source_url=f.source_url,
                doc_status=f.doc_status or "ACTIVE",
            ))

        text = (f.offending_text or "").strip()
        is_missing = text.startswith("(")
        if is_missing:
            # Structural absence -> a requirement chip, not a highlighted span.
            req = _missing_requirement_label(f)
            if req and req not in issue.missing_requirements:
                issue.missing_requirements.append(req)
        else:
            norm = _norm(text)
            if norm and norm not in seen_spans[key]:
                seen_spans[key].add(norm)
                issue.spans.append(OffendingSpan(
                    text=text.strip("\"'“”"),
                    explanation=f.explanation,
                    source=f.source,
                    confidence=f.confidence,
                ))

    return sorted(buckets.values(), key=lambda i: SEVERITY_RANK.get(i.severity, 9))


# (regex, label) — order matters; first match wins. Word boundaries avoid
# false hits like "warning" containing "arn".
_REQ_LABELS = [
    (r"\btagline\b", "AMFI-registered Mutual Fund Distributor tagline"),
    (r"\brisk\b|market[- ]risk|standard warning", "market-risk / standard warning"),
    (r"\bkey facts?\b|\bkfs\b", "Key Facts Statement reference"),
    (r"\bapr\b|annual percentage", "APR disclosure"),
    (r"sebi registration|registration number|\bIN[AH]\d", "SEBI/IRDAI registration number"),
    (r"\bdisclaimer\b|basl|nism", "SEBI/BASL/NISM disclaimer"),
    (r"identify the product as insurance|as insurance", "insurance-product identification"),
    (r"\barn\b", "ARN code"),
]
_REQ_LABELS = [(re.compile(pat, re.IGNORECASE), label) for pat, label in _REQ_LABELS]


def _missing_requirement_label(f) -> str:
    hay = f"{f.offending_text} {f.explanation}"
    for pat, label in _REQ_LABELS:
        if pat.search(hay):
            return label
    return "required disclosure"
