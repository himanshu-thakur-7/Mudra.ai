"""Semantic legal chunking.

Regulatory text is NEVER split by token count — a clause is the atomic unit.
Boundaries follow the document's legal structure (chapters, numbered clauses,
lettered/roman sub-items, FAQ questions, annexures). Oversized clauses are
split only at sentence boundaries, so no sentence is ever cut in half.

Every chunk is force-injected with source metadata (regulator, doc id, source
URL, effective date) before it goes anywhere near an embedding model.
"""

import hashlib
import re
import uuid
from dataclasses import dataclass, field

MAX_CHUNK_CHARS = 2500
MIN_SUBITEM_SPLIT_CHARS = 400  # don't explode (a)/(i) lists into confetti

BOUNDARY_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("chapter", re.compile(r"^(Chapter|CHAPTER|Annexure|ANNEXURE|Appendix|APPENDIX|Schedule|SCHEDULE)\s+[A-Z0-9IVXLC]+", re.MULTILINE)),
    ("numbered", re.compile(r"^\d{1,2}(\.\d{1,2}){0,3}[.)]?\s+(?=[A-Z“\"'(])", re.MULTILINE)),
    ("faq", re.compile(r"^Q\.?\s*\d+", re.MULTILINE)),
    ("lettered", re.compile(r"^\(?[a-hj-z]\)[\s.]", re.MULTILINE)),
    ("roman", re.compile(r"^\(?[ivxlc]{1,6}\)[\s.]", re.MULTILINE)),
]

_SENTENCE_END = re.compile(r"(?<=[.!?;])\s+")
_PAGE_NOISE = re.compile(r"^\s*(Page \d+( of \d+)?|-+\s*\d+\s*-+)\s*$", re.IGNORECASE | re.MULTILINE)


@dataclass
class Chunk:
    clause_number: str
    text: str
    kind: str  # chapter | numbered | faq | lettered | roman | preamble | table
    metadata: dict = field(default_factory=dict)
    page: int = 0  # 1-indexed source page (0 = unknown, e.g. plain-text input)
    paragraph_index: int = 0  # position within the document
    uid: str = ""  # deterministic UUID — retries overwrite, never duplicate


def _chunk_uid(doc_key: str, page: int, clause_number: str, text: str) -> str:
    """Deterministic chunk identity: hash of raw text + document identity +
    location. A re-ingested identical chunk maps to the same vector ID, so a
    retried job safely overwrites instead of duplicating (idempotency pillar)."""
    digest = hashlib.sha256(f"{doc_key}|{page}|{clause_number}|{text}".encode()).hexdigest()
    return str(uuid.uuid5(uuid.NAMESPACE_URL, digest))


def _clean(text: str) -> str:
    text = _PAGE_NOISE.sub("", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _boundary_kind(line: str) -> tuple[str, str] | None:
    for kind, pat in BOUNDARY_PATTERNS:
        m = pat.match(line)
        if m:
            label = line.strip().split()[0].rstrip(".)")
            if kind == "faq":
                label = re.sub(r"^Q\.?\s*", "Q.", m.group(0))
            return kind, label
    return None


def _split_sentences(text: str, limit: int) -> list[str]:
    """Split oversized text at sentence boundaries only."""
    parts, current = [], ""
    for sentence in _SENTENCE_END.split(text):
        if current and len(current) + len(sentence) + 1 > limit:
            parts.append(current.strip())
            current = sentence
        else:
            current = f"{current} {sentence}".strip()
    if current.strip():
        parts.append(current.strip())
    return parts


def chunk_legal(source: str | list, metadata: dict) -> list[Chunk]:
    """Segment a regulatory document by legal structure with full lineage.

    `source` is either plain text (page numbers unknown) or a list of
    PageContent-like objects (page/text/tables_md) from cascade.extract_pages.
    Every chunk carries: forced provenance metadata, source page, paragraph
    index, and a deterministic UID.
    """
    doc_key = f"{metadata.get('sha256', '')}|{metadata.get('source_url', '')}"

    # Normalise input to (line, page) pairs + per-page tables.
    lines: list[tuple[str, int]] = []
    page_tables: list[tuple[int, str]] = []
    if isinstance(source, str):
        lines = [(l, 0) for l in _clean(source).split("\n")]
    else:
        for p in source:
            for l in _clean(p.text).split("\n"):
                lines.append((l, p.page))
            for md in getattr(p, "tables_md", []) or []:
                page_tables.append((p.page, md))

    raw: list[tuple[str, str, int, list[str]]] = []  # (kind, label, page, lines)
    kind, label, page, buf = "preamble", "preamble", lines[0][1] if lines else 0, []
    for line, line_page in lines:
        hit = _boundary_kind(line)
        is_subitem = hit and hit[0] in ("lettered", "roman")
        # Sub-items only open a new chunk once the current one has real substance,
        # so short enumerations stay with their parent clause.
        if hit and (not is_subitem or sum(len(l) for l in buf) >= MIN_SUBITEM_SPLIT_CHARS):
            if any(l.strip() for l in buf):
                raw.append((kind, label, page, buf))
            kind, label = hit
            page, buf = line_page, [line]
        else:
            buf.append(line)
    if any(l.strip() for l in buf):
        raw.append((kind, label, page, buf))

    chunks: list[Chunk] = []
    current_chapter = ""
    pending_headings: list[str] = []
    para_idx = 0
    for kind, label, page, buf in raw:
        body = _clean("\n".join(buf))
        if kind == "chapter" and len(body) < 120:
            # Bare chapter heading: becomes metadata context for what follows.
            current_chapter = body
            continue
        if len(body) < 40:
            # Bare clause heading (e.g. "2. Applicability"): prepend to next chunk.
            if body:
                pending_headings.append(body)
            continue
        if pending_headings:
            body = "\n".join([*pending_headings, body])
            pending_headings = []
        chunk_meta = dict(metadata)  # forced copy: every chunk carries full provenance
        if current_chapter:
            chunk_meta["chapter"] = current_chapter
        pieces = [body] if len(body) <= MAX_CHUNK_CHARS else _split_sentences(body, MAX_CHUNK_CHARS)
        for i, piece in enumerate(pieces):
            suffix = f"/part{i+1}" if len(pieces) > 1 else ""
            clause_number = f"{label}{suffix}"
            para_idx += 1
            chunks.append(Chunk(
                clause_number=clause_number,
                text=piece,
                kind=kind,
                metadata=chunk_meta if len(pieces) == 1 else dict(chunk_meta),
                page=page,
                paragraph_index=para_idx,
                uid=_chunk_uid(doc_key, page, clause_number, piece),
            ))

    # Tables are first-class chunks: raw Markdown for precise prompt insertion,
    # a deterministic header summary for semantic matching.
    for t_i, (page, md) in enumerate(page_tables, 1):
        header = md.split("\n", 1)[0].strip("| ")
        n_rows = max(0, md.count("\n") - 1)
        summary = f"Table on page {page} ({n_rows} rows): {header}"
        text = f"{summary}\n\n{md}"
        clause_number = f"table-p{page}-{t_i}"
        para_idx += 1
        chunks.append(Chunk(
            clause_number=clause_number,
            text=text,
            kind="table",
            metadata=dict(metadata),
            page=page,
            paragraph_index=para_idx,
            uid=_chunk_uid(doc_key, page, clause_number, text),
        ))
    return chunks
