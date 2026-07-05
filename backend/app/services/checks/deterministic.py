"""Deterministic (regex/structural) compliance checks.

These run before the LLM pipeline: cheap, zero-hallucination, and they cover
the mandatory mechanical requirements an LLM might phrase inconsistently.
Each finding's clause_id points into the clause registry, so citations stay
verifiable.

Checks are audience-aware — an MFD post cites AMFI clauses, an IA/RA post
cites the SEBI Advertisement Code — mirroring the zero-cross-contamination
rule the retrieval layer applies via audience tags.
"""

import re
from dataclasses import dataclass, field

ARN_RE = re.compile(r"\bARN[-\s]?\d{3,6}\b", re.IGNORECASE)
SEBI_REG_RE = re.compile(r"\bIN[AH]\s?\d{9}\b", re.IGNORECASE)  # INA=IA, INH=RA
TAGLINE_RE = re.compile(r"AMFI[-\s]registered\s+Mutual\s+Fund\s+Distributor", re.IGNORECASE)
# SEBI standard warning (IA/RA) and the MF risk warning, tolerant to minor drift.
STANDARD_WARNING_RE = re.compile(
    r"investments?\s+in\s+(the\s+)?securities\s+market\s+are\s+subject\s+to\s+market\s+risks?",
    re.IGNORECASE,
)
MF_RISK_WARNING_RE = re.compile(
    r"mutual\s+fund\s+investments?\s+are\s+subject\s+to\s+market\s+risks?",
    re.IGNORECASE,
)
BASL_DISCLAIMER_RE = re.compile(
    r"registration\s+granted\s+by\s+SEBI.{0,120}no\s+way\s+guarantee", re.IGNORECASE | re.DOTALL
)
# Full disclaimer span, masked out before prohibition scans so the required
# wording ("…guarantee… assurance of returns…") never triggers a violation.
BASL_DISCLAIMER_FULL_RE = re.compile(
    r"registration\s+granted\s+by\s+SEBI.{0,200}?assurance\s+of\s+returns\s+to\s+investors\.?",
    re.IGNORECASE | re.DOTALL,
)
NEGATION_RE = re.compile(
    r"(\bno\s+way\b|\bnot\b|\bnever\b|\baren'?t\b|\bare\s+not\b|\bdo\s+not\b|\bdon'?t\b|"
    r"\bcannot\b|\bcan'?t\b|\bwithout\b)[^.!?\n]{0,30}$",
    re.IGNORECASE,
)
NEGATABLE_TERMS = {"guarantee", "guaranteed", "guarantees", "assured"}
GUARANTEE_RE = re.compile(
    r"\b(guarantee[ds]?|assured|risk[-\s]?free|fixed\s+returns?|surefire|100%\s*safe|no\s+risk|"
    r"pakka\s+returns?|zero\s+risk)\b",
    re.IGNORECASE,
)
RETURN_FIGURE_RE = re.compile(
    r"\b\d{1,3}(\.\d+)?\s*%\s*(p\.?a\.?|per\s+annum|annual(ised|ized)?\s+)?returns?\b"
    r"|\breturns?\s+of\s+\d{1,3}(\.\d+)?\s*%",
    re.IGNORECASE,
)
SUPERLATIVE_RE = re.compile(
    r"\b(best|no\.?\s*1|number\s+one|top[-\s]?(rated|performing|adviser|advisor|analyst|fund)|"
    r"leading|#1)\b",
    re.IGNORECASE,
)
ADVISER_TERM_RE = re.compile(
    r"\b(financial\s+plann(ing|er)|investment\s+advi[sc]e|wealth\s+manager|financial\s+advi[sc]er|"
    r"financial\s+advisor|investment\s+adviser|investment\s+advisor)\b",
    re.IGNORECASE,
)
FREE_SERVICE_RE = re.compile(
    r"\bfree\s+(advi[sc]e|portfolio\s+review|consultation|financial\s+plan|report|analysis)\b",
    re.IGNORECASE,
)


@dataclass
class DeterministicFinding:
    severity: str  # critical | major | minor
    clause_id: str
    offending_text: str
    explanation: str
    suggested_fix: str
    tags: list[str] = field(default_factory=list)


def _snippet(m: re.Match, content: str, pad: int = 40) -> str:
    start, end = max(0, m.start() - pad), min(len(content), m.end() + pad)
    return ("…" if start > 0 else "") + content[start:end].strip() + ("…" if end < len(content) else "")


def _missing_disclosure_checks_mfd(content: str) -> list[DeterministicFinding]:
    findings = []
    if not ARN_RE.search(content):
        findings.append(
            DeterministicFinding(
                severity="major",
                clause_id="AMFI-MASTERCIR-2026/1.3.6",
                offending_text="(ARN number not found in content)",
                explanation="No ARN code found. MFDs must display their name with ARN Code and the mandatory tagline in all forms of communication.",
                suggested_fix="Add your ARN, e.g. “Your Name — ARN-12345”.",
                tags=["tagline-arn"],
            )
        )
    if not TAGLINE_RE.search(content):
        findings.append(
            DeterministicFinding(
                severity="major",
                clause_id="AMFI-COC-2022/5.g",
                offending_text="(mandatory tagline not found in content)",
                explanation="The mandatory tagline “AMFI-registered Mutual Fund Distributor” must appear along with / below your name in all forms of communication.",
                suggested_fix="Add the tagline “AMFI-registered Mutual Fund Distributor” below your name.",
                tags=["tagline-arn"],
            )
        )
    if not (MF_RISK_WARNING_RE.search(content) or STANDARD_WARNING_RE.search(content)):
        findings.append(
            DeterministicFinding(
                severity="major",
                clause_id="AMFI-COC-2022/4.b",
                offending_text="(risk disclosure not found in content)",
                explanation="No market-risk warning found. Risk factors must be highlighted and not concealed in investor communications.",
                suggested_fix="Add: “Mutual fund investments are subject to market risks. Read all scheme related documents carefully before investing.”",
                tags=["risk-disclosure", "standard-warning"],
            )
        )
    return findings


def _missing_disclosure_checks_ia_ra(content: str) -> list[DeterministicFinding]:
    findings = []
    if not SEBI_REG_RE.search(content):
        findings.append(
            DeterministicFinding(
                severity="major",
                clause_id="SEBI-ADCODE-2023/1.b.vi",
                offending_text="(SEBI registration number not found in content)",
                explanation="No SEBI registration number (INA…/INH…) found. Short-form ads (SMS/social/pop-up) that omit name, address, registration number and standard disclaimer must at minimum link to the official website carrying all such details.",
                suggested_fix="Add your SEBI registration number, or a hyperlink to your official website that displays all required details.",
                tags=["identity-disclosure"],
            )
        )
    if not STANDARD_WARNING_RE.search(content):
        findings.append(
            DeterministicFinding(
                severity="major",
                clause_id="SEBI-ADCODE-2023/1.b.iii",
                offending_text="(standard warning not found in content)",
                explanation="The verbatim standard warning is missing: “Investment in securities market are subject to market risks. Read all the related documents carefully before investing.” — no addition or deletion of words is permitted.",
                suggested_fix="Add the standard warning verbatim in a legible font.",
                tags=["standard-warning"],
            )
        )
    if not BASL_DISCLAIMER_RE.search(content):
        findings.append(
            DeterministicFinding(
                severity="minor",
                clause_id="SEBI-ADCODE-2023/1.b.viii",
                offending_text="(SEBI/BASL/NISM disclaimer not found in content)",
                explanation="Advertisements and client communications must include the disclaimer that registration/membership/certification in no way guarantee performance or assure returns.",
                suggested_fix="Add: “Registration granted by SEBI, membership of BASL and certification from NISM in no way guarantee performance of the intermediary or provide any assurance of returns to investors.”",
                tags=["disclaimers"],
            )
        )
    return findings


def run_deterministic_checks(content: str, audience: str = "mfd") -> list[DeterministicFinding]:
    is_mfd = audience == "mfd"
    findings = (
        _missing_disclosure_checks_mfd(content) if is_mfd else _missing_disclosure_checks_ia_ra(content)
    )

    # Mask the mandatory disclaimer before scanning for prohibited claims —
    # its own wording contains "guarantee"/"assurance of returns".
    scan_content = BASL_DISCLAIMER_FULL_RE.sub(lambda m: " " * len(m.group(0)), content)

    assured_clause = "AMFI-COC-2022/4.g" if is_mfd else "SEBI-ADCODE-2023/1.c.x"
    for m in GUARANTEE_RE.finditer(scan_content):
        # "not guaranteed", "in no way guarantee" etc. are disclaimers, not claims.
        if m.group(0).lower() in NEGATABLE_TERMS and NEGATION_RE.search(scan_content[: m.start()]):
            continue
        findings.append(
            DeterministicFinding(
                severity="critical",
                clause_id=assured_clause,
                offending_text=_snippet(m, content),
                explanation=f"“{m.group(0)}” suggests assured/guaranteed or risk-free returns, which is prohibited — no promise or impression of assured, minimum or risk-free returns may be given.",
                suggested_fix="Remove the guarantee/assurance language; describe the product factually without promising returns.",
                tags=["assured-returns"],
            )
        )

    for m in RETURN_FIGURE_RE.finditer(content):
        findings.append(
            DeterministicFinding(
                severity="critical",
                clause_id=assured_clause,
                offending_text=_snippet(m, content),
                explanation="A specific return percentage is quoted. Indicative/target returns for any scheme, advice or transaction are prohibited.",
                suggested_fix="Remove the return figure, or use only AMC-approved factual material with required disclosures.",
                tags=["assured-returns", "past-performance"],
            )
        )

    superlative_clause = "AMFI-COC-2022/4.b" if is_mfd else "SEBI-ADCODE-2023/1.c.xiii"
    superlative_reason = (
        "is an exaggerated claim — MFDs must desist from misrepresentation or exaggerated statements"
        if is_mfd
        else "endorses quality/standing, which the SEBI Advertisement Code prohibits (only factual details of independent awards may be included)"
    )
    for m in SUPERLATIVE_RE.finditer(content):
        findings.append(
            DeterministicFinding(
                severity="major",
                clause_id=superlative_clause,
                offending_text=_snippet(m, content),
                explanation=f"Superlative term “{m.group(0)}” {superlative_reason}.",
                suggested_fix="Remove the superlative or replace it with a verifiable factual statement.",
                tags=["superlatives"],
            )
        )

    if is_mfd:
        for m in ADVISER_TERM_RE.finditer(content):
            findings.append(
                DeterministicFinding(
                    severity="major",
                    clause_id="AMFI-DOSDONTS-FAQ/Q2",
                    offending_text=_snippet(m, content),
                    explanation=f"“{m.group(0)}” implies advisory/financial-planning services, which MFDs may not offer or advertise unless registered with SEBI as an Investment Adviser.",
                    suggested_fix="Remove advisory/financial-planning terminology; describe yourself as a Mutual Fund Distributor.",
                    tags=["financial-planning-terms", "nomenclature"],
                )
            )

    free_clause = "AMFI-DOSDONTS-FAQ/Q8.c" if is_mfd else "SEBI-ADCODE-2023/1.c.ix"
    for m in FREE_SERVICE_RE.finditer(content):
        findings.append(
            DeterministicFinding(
                severity="minor",
                clause_id=free_clause,
                offending_text=_snippet(m, content),
                explanation="Advertising free advice/reviews/reports as an inducement is barred unless genuinely free without condition — and for MFDs it is barred outright as an inducement.",
                suggested_fix="Remove the free-service offer from the promotional content.",
                tags=["inducements", "free-services"],
            )
        )

    return findings
