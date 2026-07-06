"""Cascade PDF text extraction.

Indian regulatory PDFs are a mix of native text, scanned images, and outlined
fonts. The cascade tries cheap native extraction first and falls back to OCR:

  1. pdfplumber  — native text layer
  2. OCR         — render pages via macOS PDFKit (tools/render_pdf.swift),
                   then tesseract each page image

A document is routed to OCR when the native layer averages fewer than
MIN_CHARS_PER_PAGE characters per page (scanned or vector-outlined text).
"""

import shutil
import subprocess
import tempfile
from pathlib import Path

import pdfplumber

from app.core.config import REPO_DIR

MIN_CHARS_PER_PAGE = 150
RENDER_TOOL = REPO_DIR / "tools" / "render_pdf.swift"


def _native_text(pdf_path: Path) -> tuple[str, int]:
    with pdfplumber.open(pdf_path) as pdf:
        pages = [p.extract_text() or "" for p in pdf.pages]
    return "\n\n".join(pages), len(pages)


def _ocr_text(pdf_path: Path) -> str:
    if shutil.which("tesseract") is None:
        raise RuntimeError("tesseract not installed — cannot OCR scanned PDF")
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(
            ["swift", str(RENDER_TOOL), str(pdf_path), tmp],
            check=True, capture_output=True, timeout=600,
        )
        texts = []
        for png in sorted(Path(tmp).glob("page*.png"), key=lambda p: int(p.stem[4:])):
            out = subprocess.run(
                ["tesseract", str(png), "stdout", "--psm", "4", "-l", "eng"],
                check=True, capture_output=True, timeout=300,
            )
            texts.append(out.stdout.decode("utf-8", errors="replace"))
    return "\n\n".join(texts)


def extract_text_cascade(pdf_path: str | Path) -> tuple[str, str]:
    """Returns (text, method) where method is 'native' or 'ocr'."""
    pdf_path = Path(pdf_path)
    text, n_pages = _native_text(pdf_path)
    if n_pages and len(text) / n_pages >= MIN_CHARS_PER_PAGE:
        return text, "native"
    return _ocr_text(pdf_path), "ocr"
