"""Multi-agent review pipeline: reviewer -> adjudicator -> rewriter.

Hallucination containment is structural, not prompt-hoped:
- The reviewer may only cite clause IDs from the retrieved set it is shown.
- The adjudicator independently re-checks every finding against the verbatim
  clause text and drops unsupported ones.
- The caller (review_service) additionally validates every surviving clause_id
  against the registry before anything is persisted or shown.
"""

from dataclasses import dataclass, field
from typing import Any

from app.services.agents.llm import LLMClient
from app.services.retrieval.store import RetrievedClause

AUDIENCE_LABEL = {
    "mfd": "an AMFI-registered Mutual Fund Distributor (MFD)",
    "ia-ra": "a SEBI-registered Investment Adviser / Research Analyst (IA/RA)",
    "nbfc-lsp": "an RBI-regulated entity or its Lending Service Provider marketing digital loans",
    "insurance": "an IRDAI-regulated insurer or insurance intermediary/agent",
}


@dataclass
class LLMFinding:
    clause_id: str
    severity: str
    offending_text: str
    explanation: str
    suggested_fix: str
    adjudication: str = "upheld"
    confidence: float = 1.0
    raw: dict = field(default_factory=dict)


def _clause_block(clauses: list[RetrievedClause]) -> str:
    return "\n\n".join(
        f"[{c.id}] (clause {c.clause_number}{', MANDATORY requirement' if c.mandatory else ''})\n{c.text}"
        for c in clauses
    )


REVIEWER_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "findings": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "clause_id": {"type": "string"},
                    "severity": {"type": "string", "enum": ["critical", "major", "minor"]},
                    "offending_text": {"type": "string"},
                    "explanation": {"type": "string"},
                    "suggested_fix": {"type": "string"},
                },
                "required": ["clause_id", "severity", "offending_text", "explanation", "suggested_fix"],
            },
        }
    },
    "required": ["findings"],
}

ADJUDICATOR_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "decisions": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "finding_index": {"type": "integer"},
                    "decision": {"type": "string", "enum": ["upheld", "downgraded", "dropped"]},
                    "severity": {"type": "string", "enum": ["critical", "major", "minor"]},
                    "confidence": {"type": "number"},
                    "reason": {"type": "string"},
                },
                "required": ["finding_index", "decision", "severity", "confidence", "reason"],
            },
        }
    },
    "required": ["decisions"],
}

REWRITER_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "rewrite": {"type": "string"},
        "summary": {"type": "string"},
    },
    "required": ["rewrite", "summary"],
}


async def run_reviewer(
    llm: LLMClient,
    content: str,
    audience: str,
    channel: str,
    clauses: list[RetrievedClause],
    already_flagged: list[str],
) -> list[LLMFinding]:
    system = (
        "You are a compliance reviewer for Indian financial-services marketing content. "
        f"The content below was written by {AUDIENCE_LABEL.get(audience, audience)} for the '{channel}' channel. "
        "Review it ONLY against the regulatory clauses provided. Rules:\n"
        "- Cite clause_id EXACTLY as given in [brackets]; never invent or modify an ID.\n"
        "- offending_text must be a verbatim quote from the content (or a short '(missing: …)' note for absent disclosures).\n"
        "- Do not re-report the issues already flagged by deterministic checks (listed below).\n"
        "- Only flag real violations of a provided clause; if the content is compliant with a clause, stay silent about it.\n"
        "- severity: critical = prohibited claim (assured returns, misleading statement); "
        "major = missing mandatory disclosure or prohibited conduct; minor = technical/format issue."
    )
    user = (
        f"REGULATORY CLAUSES:\n{_clause_block(clauses)}\n\n"
        f"ALREADY FLAGGED BY DETERMINISTIC CHECKS (do not duplicate):\n"
        + ("\n".join(f"- {a}" for a in already_flagged) or "- none")
        + f"\n\nCONTENT TO REVIEW:\n---\n{content}\n---"
    )
    data = await llm.structured(system, user, "reviewer_findings", REVIEWER_SCHEMA)
    return [
        LLMFinding(
            clause_id=f["clause_id"].strip().strip("[]"),
            severity=f["severity"],
            offending_text=f["offending_text"],
            explanation=f["explanation"],
            suggested_fix=f["suggested_fix"],
            raw=f,
        )
        for f in data["findings"]
    ]


async def run_adjudicator(
    llm: LLMClient,
    content: str,
    findings: list[LLMFinding],
    clauses_by_id: dict[str, RetrievedClause],
) -> list[LLMFinding]:
    if not findings:
        return []
    system = (
        "You are an independent compliance adjudicator. For each finding, verify it against the "
        "VERBATIM clause text. Uphold only findings where the quoted content genuinely violates the "
        "cited clause. Drop findings that misread the clause, cite an irrelevant clause, or flag "
        "compliant content. Downgrade severity if overstated. Be strict: a finding that would not "
        "survive scrutiny by a human compliance officer must be dropped. confidence is 0.0-1.0."
    )
    numbered = []
    for i, f in enumerate(findings):
        clause = clauses_by_id.get(f.clause_id)
        clause_text = clause.text if clause else "(CLAUSE ID NOT FOUND IN REGISTRY — must be dropped)"
        numbered.append(
            f"FINDING {i}\ncited clause [{f.clause_id}]: {clause_text}\n"
            f"severity: {f.severity}\noffending_text: {f.offending_text}\nexplanation: {f.explanation}"
        )
    user = (
        f"CONTENT UNDER REVIEW:\n---\n{content}\n---\n\n" + "\n\n".join(numbered)
    )
    data = await llm.structured(system, user, "adjudication", ADJUDICATOR_SCHEMA)

    out: list[LLMFinding] = []
    decisions = {d["finding_index"]: d for d in data["decisions"]}
    for i, f in enumerate(findings):
        d = decisions.get(i)
        if d is None or d["decision"] == "dropped":
            continue
        f.adjudication = d["decision"]
        f.severity = d["severity"]
        f.confidence = max(0.0, min(1.0, float(d["confidence"])))
        out.append(f)
    return out


async def run_rewriter(
    llm: LLMClient,
    content: str,
    audience: str,
    findings_desc: list[str],
    arn_number: str | None,
    author_name: str | None = None,
) -> dict[str, str]:
    identity = ""
    if audience == "mfd":
        name = author_name or "[Your Name]"
        arn = arn_number or "[ARN-XXXXX]"
        identity = (
            f"Sign off with the author's real identity: name “{name}”, ARN “{arn}”. "
            "Never invent a different name. "
        )
    mfd_social_rule = (
        "For MFD content: do NOT name specific schemes or reference their past performance/returns "
        "in self-designed marketing (AMC pre-approval is required for scheme-specific material) — "
        "keep the rewrite educational or service-oriented instead. Never use the words "
        "'financial plan', 'financial planning', 'advice' or 'adviser' — MFDs may not advertise "
        "advisory services; say 'investment goals' or 'help you choose suitable schemes' instead. "
        if audience == "mfd"
        else ""
    )
    mandatory_bits = {
        "mfd": "the author name with ARN, the tagline “AMFI-registered Mutual Fund Distributor”, and the risk "
        "disclaimer “Mutual fund investments are subject to market risks. Read all scheme related documents "
        "carefully before investing.”",
        "ia-ra": "the SEBI registration number (or official website link), the verbatim standard warning "
        "“Investment in securities market are subject to market risks. Read all the related documents "
        "carefully before investing.”, and the SEBI/BASL/NISM no-guarantee disclaimer",
        "nbfc-lsp": "the lender (RE) name, APR (not just a flat/monthly rate), a reference to the Key Facts "
        "Statement, and neutral non-promotional presentation with no guaranteed-approval or no-credit-check claims",
        "insurance": "clear identification of the product as insurance, the insurer/intermediary registered "
        "name and IRDAI registration number, and — where benefits are not guaranteed — an equally prominent "
        "statement that they are not guaranteed",
    }.get(audience, "all disclosures the cited clauses require")
    system = (
        "You rewrite Indian financial-services marketing content to be compliant while preserving the "
        "author's voice, language and intent as much as legally possible. "
        f"{identity}{mfd_social_rule}Fix every violation listed. Ensure the rewrite includes {mandatory_bits}. "
        "Remove prohibited claims entirely rather than softening them. Keep it natural for the channel "
        "(e.g. a WhatsApp post stays short; emojis may stay). "
        "Write the rewrite in the SAME language/mix as the original (Hindi stays Hindi, Hinglish stays "
        "Hinglish); mandatory warnings must be accurately translated into that language, since regulators "
        "require the standard warning in the advertisement's own language. "
        "Also produce a one-sentence plain-English summary of what was wrong overall."
    )
    user = (
        f"VIOLATIONS TO FIX:\n" + "\n".join(f"- {d}" for d in findings_desc)
        + f"\n\nORIGINAL CONTENT:\n---\n{content}\n---"
    )
    return await llm.structured(system, user, "rewrite", REWRITER_SCHEMA)
