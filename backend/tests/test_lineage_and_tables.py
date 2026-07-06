"""Pillars 2–4: layout-aware tables, page/paragraph lineage, deterministic
chunk UUIDs, supersession-hint detection."""

from app.core.config import CORPUS_DIR
from app.services.corpus.cascade import PageContent, extract_pages
from app.services.corpus.chunker import chunk_legal
from app.workers.consumer import detect_supersession_hints

META = {"regulator": "RBI", "source_url": "https://x/doc.pdf", "sha256": "abc123"}

PAGES = [
    PageContent(page=1, text="1. Short title\nThese Directions shall be called the Test Directions, 2025. They apply to all regulated entities without exception."),
    PageContent(
        page=2,
        text="2. Disclosures\nEvery lender shall disclose the following charges to the borrower before sanction.",
        tables_md=["| Charge | Rate |\n|---|---|\n| Processing fee | 1% |\n| Penal charge | 2% p.a. |"],
    ),
]


def test_chunks_carry_page_and_paragraph_lineage():
    chunks = chunk_legal(PAGES, META)
    body = [c for c in chunks if c.kind != "table"]
    assert body[0].page == 1 and body[-1].page == 2
    assert [c.paragraph_index for c in chunks] == sorted(c.paragraph_index for c in chunks)
    assert all(c.uid for c in chunks)


def test_chunk_uids_deterministic_for_idempotent_reingestion():
    a = chunk_legal(PAGES, META)
    b = chunk_legal(PAGES, META)
    assert [c.uid for c in a] == [c.uid for c in b]
    # different document identity -> different vector IDs
    c = chunk_legal(PAGES, {**META, "sha256": "zzz999"})
    assert [x.uid for x in a] != [x.uid for x in c]


def test_tables_become_first_class_markdown_chunks():
    chunks = chunk_legal(PAGES, META)
    tables = [c for c in chunks if c.kind == "table"]
    assert len(tables) == 1
    t = tables[0]
    assert t.page == 2
    assert "| Charge | Rate |" in t.text          # raw markdown preserved
    assert t.text.startswith("Table on page 2")   # semantic summary for search
    assert "Penal charge" in t.text


def test_real_pdf_table_extraction_native():
    pages, method = extract_pages(CORPUS_DIR / "sources" / "amfi-master-circular-mfds.pdf")
    assert method == "native"
    assert any(p.tables_md for p in pages), "89-page master circular must contain detected tables"


def test_supersession_hints_detected_with_refs():
    pages = [PageContent(page=3, text=(
        "These Directions consolidate and replace the instructions contained in the "
        "Guidelines on Digital Lending DOR.CRE.REC.66/21.07.001/2022-23 dated September 02, 2022, "
        "which stands repealed from the date of these Directions."
    ))]
    hints = detect_supersession_hints(pages)
    assert hints and hints[0]["page"] == 3
    assert any("DOR.CRE.REC.66" in r for r in hints[0]["refs"])


def test_no_false_hints_on_plain_text():
    assert detect_supersession_hints([PageContent(page=1, text="Lenders shall be fair and transparent.")]) == []
