"""Semantic legal chunking.

Regulatory text is NEVER split by token count — a clause is the atomic unit.
Boundaries follow the document's legal structure (chapters, numbered clauses,
lettered/roman sub-items, FAQ questions, annexures). Oversized clauses are
split only at sentence boundaries, so no sentence is ever cut in half.

Every chunk is force-injected with source metadata (regulator, doc id, source
URL, effective date) before it goes anywhere near an embedding model.
"""

import re
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
    kind: str  # chapter | numbered | faq | lettered | roman | preamble
    metadata: dict = field(default_factory=dict)


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


def chunk_legal(text: str, metadata: dict) -> list[Chunk]:
    """Segment a regulatory document by legal structure, metadata-tagging every chunk."""
    text = _clean(text)
    lines = text.split("\n")

    raw: list[tuple[str, str, list[str]]] = []  # (kind, label, lines)
    kind, label, buf = "preamble", "preamble", []
    for line in lines:
        hit = _boundary_kind(line)
        is_subitem = hit and hit[0] in ("lettered", "roman")
        # Sub-items only open a new chunk once the current one has real substance,
        # so short enumerations stay with their parent clause.
        if hit and (not is_subitem or sum(len(l) for l in buf) >= MIN_SUBITEM_SPLIT_CHARS):
            if any(l.strip() for l in buf):
                raw.append((kind, label, buf))
            kind, label = hit
            buf = [line]
        else:
            buf.append(line)
    if any(l.strip() for l in buf):
        raw.append((kind, label, buf))

    chunks: list[Chunk] = []
    current_chapter = ""
    pending_headings: list[str] = []
    for kind, label, buf in raw:
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
            chunks.append(Chunk(
                clause_number=f"{label}{suffix}",
                text=piece,
                kind=kind,
                metadata=chunk_meta if len(pieces) == 1 else dict(chunk_meta),
            ))
    return chunks
