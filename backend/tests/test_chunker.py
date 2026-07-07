"""Phase 3 — PyMuPDF layout-aware chunker: clause grouping + markdown tables.
Runs against the committed SEBI source PDF (native text)."""

from app.core.config import CORPUS_DIR
from app.services.corpus.chunker import (
    CorpusChunk,
    _looks_tabular,
    _to_markdown_table,
    extract_chunks,
)

SEBI_PDF = CORPUS_DIR / "sources" / "sebi-adcode-2023.pdf"
AMFI_MASTER = CORPUS_DIR / "sources" / "amfi-master-circular-mfds.pdf"


def test_extract_chunks_groups_by_clause():
    chunks = extract_chunks(SEBI_PDF, "SEBI", "SEBI-ADCODE-2023", source_url="https://sebi.gov.in/x.pdf")
    assert len(chunks) >= 5
    assert all(isinstance(c, CorpusChunk) for c in chunks)
    # every chunk carries the doc id prefix + a clause marker
    assert all(c.clauseId.startswith("SEBI-ADCODE-2023/") for c in chunks)
    # provenance + defaults
    assert all(c.regulator == "SEBI" and c.status == "ACTIVE" and c.sourcePdfUrl for c in chunks)
    # the prohibitions clause block should be captured somewhere
    joined = "\n".join(c.rawText for c in chunks).lower()
    assert "guarantee" in joined and "past performance" in joined


def test_markdown_table_detection():
    tabular = "Name    Rate    Unit\nProcessing fee    1%    flat\nPenal charge    2%    p.a."
    assert _looks_tabular(tabular)
    md = _to_markdown_table(tabular)
    assert md is not None
    assert md.startswith("| Name | Rate | Unit |")
    assert "|---|---|---|" in md
    assert "| Penal charge | 2% | p.a. |" in md


def test_pipe_delimited_table():
    md = _to_markdown_table("Col A | Col B\n1 | 2\n3 | 4")
    assert md is not None and "| Col A | Col B |" in md


def test_prose_is_not_a_table():
    assert not _looks_tabular("This is an ordinary regulatory sentence about advertisements.")


def test_real_master_circular_yields_tables():
    # the 89-page AMFI master circular contains fee/appendix tables
    chunks = extract_chunks(AMFI_MASTER, "AMFI", "AMFI-MASTERCIR-2026")
    assert len(chunks) > 10
    with_tables = [c for c in chunks if "|---|" in c.cleanMarkdown or "| ---" in c.cleanMarkdown]
    assert with_tables, "expected at least one rendered markdown table in the master circular"
