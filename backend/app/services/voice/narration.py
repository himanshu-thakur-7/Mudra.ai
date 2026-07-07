"""Turn a grouped review into a spoken compliance briefing.

The voice copilot reads the verdict, walks each flagged issue (what's wrong +
the exact clause and page it violates), then reads out the ready-to-post
rewrite — the way a compliance officer would talk a distributor through it.
"""

from dataclasses import dataclass

from app.models import Review
from app.services.grouping import group_findings

VERDICT_OPENER = {
    "fail": "Hold on — please don't post this yet. I found content that regulators prohibit.",
    "needs_changes": "This needs a few changes before it's safe to post.",
    "pass": "Good news — this looks compliant.",
    "error": "I could only run a partial check, so treat this with caution.",
}


@dataclass
class NarrationSegment:
    kind: str  # verdict | issue | rewrite
    label: str
    text: str


def build_narration(review: Review) -> tuple[str, list[NarrationSegment]]:
    """Returns (full_script, segments) — segments let the UI highlight in sync."""
    issues = group_findings(review.findings)
    segments: list[NarrationSegment] = []

    opener = VERDICT_OPENER.get(review.verdict, "Here's your compliance review.")
    n = len(issues)
    if n:
        opener += f" There {'is' if n == 1 else 'are'} {n} issue{'s' if n != 1 else ''} to fix."
    segments.append(NarrationSegment("verdict", "Verdict", opener))

    for i, issue in enumerate(issues, 1):
        parts = [f"Issue {i}: {issue.title}."]
        if issue.spans:
            first = issue.spans[0]
            parts.append(f"You wrote, quote, {first.text}, unquote. {first.explanation}")
        if issue.missing_requirements:
            parts.append("You're also missing: " + ", ".join(issue.missing_requirements) + ".")
        if issue.citations:
            c = issue.citations[0]
            page = f", page {c.source_page}" if c.source_page else ""
            parts.append(f"This is under {_speak_clause(c.clause_id)}{page} of the {c.regulator} rulebook, which is currently active.")
        segments.append(NarrationSegment("issue", issue.title, " ".join(parts)))

    if review.rewrite:
        segments.append(NarrationSegment(
            "rewrite", "Compliant version",
            "Here's a version you can post right away. " + _speakable(review.rewrite),
        ))

    script = "\n\n".join(s.text for s in segments)
    return script, segments


def _speak_clause(clause_id: str) -> str:
    """Make a clause id sound natural: 'AMFI-COC-2022/4.g' -> 'AMFI code of
    conduct 2022, clause 4 g'."""
    doc, _, num = clause_id.partition("/")
    doc = doc.replace("-", " ")
    return f"{doc}{', clause ' + num.replace('.', ' ') if num else ''}"


def _speakable(text: str) -> str:
    """Strip emojis / hard line breaks so TTS reads smoothly."""
    cleaned = " ".join(text.split())
    return "".join(ch for ch in cleaned if ch.isprintable() and ord(ch) < 0x2190)
