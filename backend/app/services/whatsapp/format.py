"""WhatsApp reply formatting (TwiML)."""

from xml.sax.saxutils import escape

from app.models import Review

VERDICT_EMOJI = {"pass": "✅", "needs_changes": "⚠️", "fail": "🚫", "error": "ℹ️"}
VERDICT_TEXT = {
    "pass": "Looks compliant",
    "needs_changes": "Needs changes before posting",
    "fail": "Do NOT post this — prohibited content",
    "error": "Partial check only (service issue) — treat with caution",
}


def format_whatsapp_reply(review: Review, web_url: str, max_issues: int = 4) -> str:
    from app.services.grouping import group_findings

    issues = group_findings(review.findings)
    lines = [
        f"{VERDICT_EMOJI.get(review.verdict, '')} *{VERDICT_TEXT.get(review.verdict, review.verdict)}*",
        "",
    ]
    if issues:
        lines.append(f"*{len(issues)} issue{'s' if len(issues) != 1 else ''} found:*")
        for issue in issues[:max_issues]:
            clause = issue.citations[0].clause_id if issue.citations else ""
            lines.append(f"• [{issue.severity}] {issue.title} ({clause})")
        lines.append("")
    if review.rewrite:
        lines.append("*✅ Ready-to-post compliant version:*")
        lines.append(review.rewrite)
        lines.append("")
    lines.append(f"Full report + audit PDF: {web_url}/reviews/{review.id}")
    lines.append("_Pre-review co-pilot — final responsibility stays with you._")
    return "\n".join(lines)


def twiml_message(text: str) -> str:
    return f'<?xml version="1.0" encoding="UTF-8"?><Response><Message>{escape(text)}</Message></Response>'
