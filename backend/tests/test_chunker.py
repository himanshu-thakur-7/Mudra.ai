"""Legal-structure chunker: boundaries follow legal structure, never token counts."""

from app.services.corpus.chunker import MAX_CHUNK_CHARS, chunk_legal

META = {"regulator": "RBI", "source_url": "https://x", "sha256": "abc"}

DOC = """Reserve Bank of India
Digital Lending Directions, 2025

Chapter I Preliminary

1. Short title and commencement
These Directions shall be called the Digital Lending Directions, 2025. They shall come into force with immediate effect.

2. Applicability
2.1 These Directions shall apply to all commercial banks and non-banking financial companies engaged in digital lending. The provisions cover every lending service provider engaged by a regulated entity, and extend to all digital lending apps deployed for sourcing, underwriting or servicing loans across products and platforms in India.
2.2 Nothing in these Directions shall absolve the regulated entity of its responsibilities.

Q.1 What is a Key Facts Statement?
A Key Facts Statement means a statement of key facts of a loan agreement, in simple language.

Chapter II Marketing Norms

3. Advertising conduct
Lending Service Providers must remain impartial and objective, and must not directly or indirectly endorse or promote the product of any specific regulated entity. Advertisements must not be misleading in any manner whatsoever.
Page 4 of 12
"""


def test_chunks_follow_legal_structure():
    chunks = chunk_legal(DOC, META)
    labels = [c.clause_number for c in chunks]
    assert any(c.kind == "faq" and c.clause_number.startswith("Q.") for c in chunks)
    numbered = [c for c in chunks if c.kind == "numbered"]
    assert numbered, labels
    # chapter headings become metadata context on following clauses
    marketing = next(c for c in chunks if "Advertising conduct" in c.text)
    assert "Chapter II" in marketing.metadata.get("chapter", "")
    # bare clause headings are prepended, not dropped
    applicability = next(c for c in chunks if c.clause_number == "2.1")
    assert "2. Applicability" in applicability.text


def test_every_chunk_carries_forced_metadata():
    for c in chunk_legal(DOC, META):
        assert c.metadata["regulator"] == "RBI"
        assert c.metadata["source_url"] == "https://x"


def test_page_noise_stripped():
    assert not any("Page 4 of 12" in c.text for c in chunk_legal(DOC, META))


def test_oversized_clause_splits_at_sentence_boundaries_only():
    long_doc = "1. Long clause\n" + " ".join(
        f"This is sentence number {i} of an extremely verbose regulatory clause." for i in range(120)
    )
    chunks = chunk_legal(long_doc, META)
    assert len(chunks) > 1
    for c in chunks:
        assert len(c.text) <= MAX_CHUNK_CHARS + 100
        assert c.text.rstrip().endswith(".")  # never cut mid-sentence


def test_short_subitems_stay_with_parent():
    doc = """4. Prohibited conduct
The following are prohibited:
(a) misleading claims.
(b) dark patterns.
(c) hidden charges.
"""
    chunks = chunk_legal(doc, META)
    assert len(chunks) == 1  # tiny (a)/(b)/(c) items must not explode into confetti
    assert "(b) dark patterns." in chunks[0].text
