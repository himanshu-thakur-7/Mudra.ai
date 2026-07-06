"""Cascade PDF extraction — layout-aware and page-preserving.

Indian regulatory PDFs are a mix of native text, scanned images, and outlined
fonts, and the critical details (font-size mandates, APR tables, disclosure
matrices) usually live inside tables that naive text extraction scrambles.

  1. pdfplumber — native text layer + geometric table detection per page;
     each table is converted to clean Markdown (and excluded from the plain
     text flow so it is never half-duplicated as scrambled rows).
  2. OCR — pages rendered via macOS PDFKit (tools/render_pdf.swift), then
     tesseract per page. Chosen when the native layer averages fewer than
     MIN_CHARS_PER_PAGE characters per page.

Page numbers are preserved end-to-end: every downstream chunk knows the exact
page it came from (courtroom-grade lineage for Reg 16C audit trails).
"""

import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

import pdfplumber

from app.core.config import REPO_DIR

MIN_CHARS_PER_PAGE = 150
RENDER_TOOL = REPO_DIR / "tools" / "render_pdf.swift"


@dataclass
class PageContent:
    page: int  # 1-indexed, exactly as a human would cite it
    text: str
    tables_md: list[str] = field(default_factory=list)


def _table_to_markdown(rows: list[list[str | None]]) -> str | None:
    rows = [[(c or "").replace("\n", " ").strip() for c in r] for r in rows if r]
    rows = [r for r in rows if any(r)]
    if len(rows) < 2 or len(rows[0]) < 2:
        return None  # not a real table — skip rather than fabricate structure
    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]
    header, body = rows[0], rows[1:]
    lines = ["| " + " | ".join(header) + " |", "|" + "---|" * width]
    lines += ["| " + " | ".join(r) + " |" for r in body]
    return "\n".join(lines)


def extract_pages(pdf_path: str | Path) -> tuple[list[PageContent], str]:
    """Returns (pages, method) where method is 'native' or 'ocr'."""
    pdf_path = Path(pdf_path)
    pages: list[PageContent] = []
    total_chars = 0
    with pdfplumber.open(pdf_path) as pdf:
        for i, p in enumerate(pdf.pages):
            tables_md = []
            table_bboxes = []
            try:
                for tbl in p.find_tables():
                    md = _table_to_markdown(tbl.extract())
                    if md:
                        tables_md.append(md)
                        table_bboxes.append(tbl.bbox)
            except Exception:
                pass  # geometry failures must not sink text extraction
            # Remove table regions from the text flow so tables are not
            # duplicated as scrambled row-by-row text.
            page_obj = p
            for bbox in table_bboxes:
                try:
                    page_obj = page_obj.outside_bbox(bbox)
                except Exception:
                    break
            text = page_obj.extract_text() or ""
            total_chars += len(text) + sum(len(t) for t in tables_md)
            pages.append(PageContent(page=i + 1, text=text, tables_md=tables_md))

    if pages and total_chars / len(pages) >= MIN_CHARS_PER_PAGE:
        return pages, "native"
    return _ocr_pages(pdf_path), "ocr"


def _ocr_pages(pdf_path: Path) -> list[PageContent]:
    if shutil.which("tesseract") is None:
        raise RuntimeError("tesseract not installed — cannot OCR scanned PDF")
    pages: list[PageContent] = []
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(
            ["swift", str(RENDER_TOOL), str(pdf_path), tmp],
            check=True, capture_output=True, timeout=600,
        )
        pngs = sorted(Path(tmp).glob("page*.png"), key=lambda p: int(p.stem[4:]))
        for png in pngs:
            out = subprocess.run(
                ["tesseract", str(png), "stdout", "--psm", "4", "-l", "eng"],
                check=True, capture_output=True, timeout=300,
            )
            pages.append(PageContent(
                page=int(png.stem[4:]),
                text=out.stdout.decode("utf-8", errors="replace"),
            ))
    return pages


def extract_text_cascade(pdf_path: str | Path) -> tuple[str, str]:
    """Back-compat: flat text (tables appended as Markdown per page)."""
    pages, method = extract_pages(pdf_path)
    parts = []
    for p in pages:
        parts.append(p.text)
        parts.extend(p.tables_md)
    return "\n\n".join(parts), method
