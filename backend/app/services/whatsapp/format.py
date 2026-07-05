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


def format_whatsapp_reply(review: Review, web_url: str, max_findings: int = 3) -> str:
    lines = [
        f"{VERDICT_EMOJI.get(review.verdict, '')} *{VERDICT_TEXT.get(review.verdict, review.verdict)}*",
        "",
    ]
    if review.findings:
        lines.append(f"Top issues ({min(len(review.findings), max_findings)} of {len(review.findings)}):")
        for f in review.findings[:max_findings]:
            lines.append(f"• [{f.severity}] {f.explanation} ({f.clause_id})")
        lines.append("")
    if review.rewrite:
        lines.append("*Suggested compliant version:*")
        lines.append(review.rewrite)
        lines.append("")
    lines.append(f"Full report + audit PDF: {web_url}/reviews/{review.id}")
    lines.append("_Pre-review co-pilot — final responsibility stays with you._")
    return "\n".join(lines)


def twiml_message(text: str) -> str:
    return f'<?xml version="1.0" encoding="UTF-8"?><Response><Message>{escape(text)}</Message></Response>'
