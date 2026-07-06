"""Audit-trail PDF: the Reg-16C artefact.

One page-flow document per review: submission hash + timestamps, verdict,
every finding with its verbatim clause quote, the compliant rewrite, the
pipeline stage journal, and the human-accountability acknowledgment line.
"""

import io
from datetime import timezone

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    HRFlowable,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.models import Review

VERDICT_LABELS = {
    "pass": ("PASS — no issues found", colors.HexColor("#166534")),
    "needs_changes": ("NEEDS CHANGES", colors.HexColor("#b45309")),
    "fail": ("FAIL — prohibited content found", colors.HexColor("#b91c1c")),
    "error": ("PARTIAL REVIEW (LLM unavailable)", colors.HexColor("#6b7280")),
}

SEV_COLOR = {
    "critical": colors.HexColor("#b91c1c"),
    "major": colors.HexColor("#b45309"),
    "minor": colors.HexColor("#2563eb"),
}


def _esc(text: str) -> str:
    return (text or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def build_audit_pdf(review: Review) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=16 * mm, bottomMargin=16 * mm, title=f"Compliance pre-review audit {review.id}",
    )
    ss = getSampleStyleSheet()
    body = ParagraphStyle("body", parent=ss["BodyText"], fontSize=9, leading=12)
    small = ParagraphStyle("small", parent=body, fontSize=7.5, textColor=colors.HexColor("#6b7280"))
    h1 = ParagraphStyle("h1", parent=ss["Heading1"], fontSize=15, spaceAfter=2)
    h2 = ParagraphStyle("h2", parent=ss["Heading2"], fontSize=11, spaceBefore=10, spaceAfter=4)
    quote = ParagraphStyle(
        "quote", parent=body, fontSize=8, leading=11, leftIndent=8,
        textColor=colors.HexColor("#374151"), borderPadding=4,
    )

    story = []
    story.append(Paragraph("Compliance Pre-Review — Audit Trail", h1))
    story.append(Paragraph(
        "Pre-review co-pilot output. This report assists — it does not replace — the "
        "compliance officer, who remains accountable for the final decision.", small))
    story.append(Spacer(1, 6))

    created = review.created_at.replace(tzinfo=review.created_at.tzinfo or timezone.utc)
    verdict_label, verdict_color = VERDICT_LABELS.get(review.verdict, (review.verdict, colors.black))
    meta = Table(
        [
            ["Review ID", review.id],
            ["Timestamp (UTC)", created.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")],
            ["Channel / Audience", f"{review.channel} / {review.audience.upper()}"],
            ["Content SHA-256", review.content_sha256],
            ["Verdict", verdict_label],
        ],
        colWidths=[38 * mm, 136 * mm],
    )
    meta.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("TEXTCOLOR", (1, 4), (1, 4), verdict_color),
        ("FONTNAME", (1, 4), (1, 4), "Helvetica-Bold"),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#e5e7eb")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    story.append(meta)

    story.append(Paragraph("Submitted content", h2))
    story.append(Paragraph(_esc(review.content).replace("\n", "<br/>"), quote))

    # Remediation is presented first: one compliant rewrite resolving everything.
    if review.rewrite:
        story.append(Paragraph("Recommended compliant version", h2))
        story.append(Paragraph(_esc(review.rewrite).replace("\n", "<br/>"), quote))

    from app.services.grouping import group_findings

    issues = group_findings(review.findings)
    story.append(Paragraph(f"Issues ({len(issues)})", h2))
    if not issues:
        story.append(Paragraph("No violations found.", body))
    for i, issue in enumerate(issues, 1):
        sev = SEV_COLOR.get(issue.severity, colors.black)
        story.append(Paragraph(
            f'<font color="{sev.hexval()}"><b>{i}. [{issue.severity.upper()}] {_esc(issue.title)}</b></font>',
            body))
        for span in issue.spans:
            story.append(Paragraph(f"Flagged text: <i>“{_esc(span.text)}”</i> — {_esc(span.explanation)}", quote))
        if issue.missing_requirements:
            story.append(Paragraph("Missing: " + _esc(", ".join(issue.missing_requirements)), quote))
        for cit in issue.citations:
            page = f", p.{cit.source_page}" if cit.source_page else ""
            story.append(Paragraph(
                f"Authority: <b>{_esc(cit.clause_id)}</b> ({_esc(cit.regulator)}{page}, status: {cit.doc_status})", small))
            story.append(Paragraph(f"“{_esc(cit.clause_quote)}”", quote))
            if cit.source_url:
                story.append(Paragraph(f"Source: {_esc(cit.source_url)}", small))
        story.append(Spacer(1, 6))

    story.append(Paragraph("Pipeline journal", h2))
    rows = [["#", "Stage", "Timestamp (UTC)"]]
    for i, e in enumerate(review.audit_events, 1):
        ts = e.created_at.replace(tzinfo=e.created_at.tzinfo or timezone.utc)
        rows.append([str(i), e.stage, ts.astimezone(timezone.utc).strftime("%H:%M:%S.%f")[:-3]])
    journal = Table(rows, colWidths=[10 * mm, 90 * mm, 74 * mm])
    journal.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#e5e7eb")),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(journal)

    story.append(Spacer(1, 10))
    story.append(HRFlowable(width="100%", color=colors.HexColor("#e5e7eb")))
    story.append(Paragraph(
        "Reviewer acknowledgment: I have reviewed the above findings and the final content is my "
        "responsibility as the regulated entity. &nbsp;&nbsp;&nbsp; Signature: ______________________ "
        "&nbsp;&nbsp; Date: ____________", small))

    doc.build(story)
    return buf.getvalue()
