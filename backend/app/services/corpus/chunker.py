"""Mudra.ai — Phase 3: layout-aware PDF ingestion worker.

The Python backend's ONLY job: parse messy regulator PDFs into clean, clause-
grouped, layout-aware chunks and POST them to Convex. No orchestration, no
local vector storage — Convex owns both.

  uv run python -m app.services.corpus.chunker <pdf> --regulator SEBI --doc-id SEBI-ADCODE-2023

Pipeline: PyMuPDF text blocks → table blocks rendered as Markdown → chunks
grouped on clause-break regex → HTTP POST to the Convex `corpus/bulkIngest`
action, which embeds and upserts each chunk into `regulatoryCorpus`.
"""

from __future__ import annotations

import argparse
import re
from dataclasses import asdict, dataclass, field
from datetime import date
from pathlib import Path

import fitz  # PyMuPDF
import requests

from app.core.config import get_settings

# Clause-break markers: "4.", "4.2", "4.g", "(a)", "(iv)", "Clause 4.g", "Q.3",
# "Chapter III". Matched at the start of a block's first line.
CLAUSE_BREAK = re.compile(
    r"^\s*(?:Clause\s+)?("
    r"\d{1,2}(?:\.\d{1,2}){0,3}[.)]?"      # 4  4.2  4.2.1
    r"|\d{1,2}\.[a-z]"                       # 4.g
    r"|\(?[a-z]\)"                           # (a)  a)
    r"|\(?[ivxl]{1,5}\)"                     # (iv)
    r"|Q\.?\s*\d+"                           # Q.3
    r"|Chapter\s+[IVXLC0-9]+"                # Chapter III
    r"|Annexure\s+[A-Z0-9]+"
    r")\b",
    re.IGNORECASE,
)

# A block looks tabular if it has "|" or ≥2 lines each split by runs of 2+ spaces.
_MULTISPACE = re.compile(r"\s{2,}")


@dataclass
class CorpusChunk:
    regulator: str
    clauseId: str
    rawText: str
    cleanMarkdown: str
    sourcePdfUrl: str = ""
    validFrom: str = field(default_factory=lambda: date.today().isoformat())
    status: str = "ACTIVE"


def _looks_tabular(text: str) -> bool:
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if len(lines) < 2:
        return False
    if any("|" in ln for ln in lines):
        return True
    multicol = sum(1 for ln in lines if len(_MULTISPACE.split(ln.strip())) >= 3)
    return multicol >= 2


def _to_markdown_table(text: str) -> str | None:
    """Render a whitespace/pipe-delimited block as a GitHub Markdown table."""
    rows: list[list[str]] = []
    for ln in text.splitlines():
        if not ln.strip():
            continue
        cells = [c.strip() for c in (ln.split("|") if "|" in ln else _MULTISPACE.split(ln.strip()))]
        cells = [c for c in cells if c != ""]
        if cells:
            rows.append(cells)
    rows = [r for r in rows if r]
    if len(rows) < 2:
        return None
    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]
    header, body = rows[0], rows[1:]
    out = ["| " + " | ".join(header) + " |", "|" + "---|" * width]
    out += ["| " + " | ".join(r) + " |" for r in body]
    return "\n".join(out)


def extract_chunks(pdf_path: str | Path, regulator: str, doc_id: str, source_url: str = "") -> list[CorpusChunk]:
    """PyMuPDF block extraction → layout-aware, clause-grouped chunks."""
    pdf_path = Path(pdf_path)
    chunks: list[CorpusChunk] = []

    cur_marker = "preamble"
    raw_parts: list[str] = []
    md_parts: list[str] = []

    def flush():
        raw = "\n".join(raw_parts).strip()
        md = "\n\n".join(md_parts).strip()
        if len(raw) >= 40:
            chunks.append(CorpusChunk(
                regulator=regulator,
                clauseId=f"{doc_id}/{cur_marker}",
                rawText=raw,
                cleanMarkdown=md or raw,
                sourcePdfUrl=source_url,
            ))

    with fitz.open(pdf_path) as doc:
        for page in doc:
            # blocks: (x0, y0, x1, y1, "text", block_no, block_type)
            for b in sorted(page.get_text("blocks"), key=lambda b: (round(b[1]), b[0])):
                text = (b[4] or "").strip()
                if not text:
                    continue
                first_line = text.splitlines()[0]
                m = CLAUSE_BREAK.match(first_line)
                if m:
                    flush()
                    cur_marker = m.group(1).replace(" ", "")
                    raw_parts, md_parts = [text], []
                    if _looks_tabular(text):
                        tbl = _to_markdown_table(text)
                        md_parts.append(tbl or text)
                    else:
                        md_parts.append(text)
                    continue
                raw_parts.append(text)
                if _looks_tabular(text):
                    tbl = _to_markdown_table(text)
                    md_parts.append(tbl or text)
                else:
                    md_parts.append(text)
    flush()
    return chunks


def push_to_convex(chunks: list[CorpusChunk]) -> dict:
    """POST structured chunks straight to the Convex bulkIngest HTTP action.
    Convex HTTP actions are served on the .convex.site domain."""
    settings = get_settings()
    site = settings.convex_site_url or settings.convex_url.replace(".convex.cloud", ".convex.site")
    if not site:
        raise RuntimeError("CONVEX_URL / CONVEX_SITE_URL not configured")
    headers = {"Content-Type": "application/json"}
    if settings.convex_ingest_token:
        headers["x-ingest-token"] = settings.convex_ingest_token
    resp = requests.post(
        f"{site.rstrip('/')}/api/actions/corpus/bulkIngest",
        json={"chunks": [asdict(c) for c in chunks]},
        headers=headers,
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()


def main() -> None:
    parser = argparse.ArgumentParser(description="Mudra.ai layout-aware PDF ingestion worker")
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--regulator", required=True)
    parser.add_argument("--doc-id", required=True)
    parser.add_argument("--source-url", default="")
    parser.add_argument("--dry-run", action="store_true", help="parse only; do not POST to Convex")
    args = parser.parse_args()

    chunks = extract_chunks(args.pdf, args.regulator, args.doc_id, args.source_url)
    print(f"Extracted {len(chunks)} clause-grouped chunks from {args.pdf.name}")
    tables = sum(1 for c in chunks if "|" in c.cleanMarkdown and "---" in c.cleanMarkdown)
    print(f"  {tables} chunk(s) contain a rendered Markdown table")
    if args.dry_run:
        for c in chunks[:3]:
            print(f"\n--- {c.clauseId} ---\n{c.cleanMarkdown[:300]}")
        return
    result = push_to_convex(chunks)
    print(f"Pushed to Convex: {result}")


if __name__ == "__main__":
    main()
