"""Corpus ingestion CLI.

  uv run python -m app.services.corpus.ingest load          # registry JSON -> DB (+ embeddings)
  uv run python -m app.services.corpus.ingest load --no-embed
  uv run python -m app.services.corpus.ingest extract <pdf> --regulator SEBI --doc-id MY-DOC
                                                             # PDF -> draft clause JSON (LLM-assisted)

`load` is idempotent: docs/clauses are upserted by ID. The committed
corpus/processed/clauses.json is the human-reviewed source of truth;
`extract` only produces drafts that must be reviewed before merging in.
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np

from app.core.config import CORPUS_DIR, get_settings
from app.core.db import get_session_factory, init_db
from app.models import Clause, CorpusDoc

REGISTRY_PATH = CORPUS_DIR / "processed" / "clauses.json"


def embed_texts(texts: list[str]) -> list[np.ndarray]:
    from openai import OpenAI

    settings = get_settings()
    client = OpenAI(api_key=settings.openai_api_key)
    out: list[np.ndarray] = []
    for i in range(0, len(texts), 100):
        resp = client.embeddings.create(
            model=settings.openai_embedding_model, input=texts[i : i + 100]
        )
        out.extend(np.array(d.embedding, dtype=np.float32) for d in resp.data)
    return out


def load_registry(registry_path: Path = REGISTRY_PATH, embed: bool = True) -> tuple[int, int]:
    data = json.loads(registry_path.read_text())
    init_db()
    db = get_session_factory()()
    try:
        doc_meta = {d["id"]: d for d in data["docs"]}
        for d in data["docs"]:
            doc = db.get(CorpusDoc, d["id"]) or CorpusDoc(id=d["id"])
            doc.regulator = d["regulator"]
            doc.title = d["title"]
            doc.source_url = d.get("source_url", "")
            doc.source_file = d.get("source_file", "")
            doc.effective_date = d.get("effective_date", "")
            doc.status = d.get("status", "ACTIVE")
            doc.supersedes = d.get("supersedes", [])
            doc.superseded_by = d.get("superseded_by")
            db.merge(doc)

        clauses = data["clauses"]
        embeddings = embed_texts([c["text"] for c in clauses]) if embed else [None] * len(clauses)
        for c, vec in zip(clauses, embeddings):
            parent = doc_meta.get(c["doc_id"], {})
            clause = db.get(Clause, c["id"]) or Clause(id=c["id"])
            clause.doc_id = c["doc_id"]
            clause.clause_number = c["clause_number"]
            clause.text = c["text"]
            clause.tags = c.get("tags", [])
            clause.mandatory = c.get("mandatory", False)
            # Temporal fields inherit from the parent doc unless overridden.
            clause.status = c.get("status", parent.get("status", "ACTIVE"))
            clause.valid_from = c.get("valid_from", parent.get("effective_date", ""))
            clause.valid_to = c.get("valid_to")
            if vec is not None:
                clause.embedding = vec.tobytes()
            db.merge(clause)
        db.commit()
        return len(data["docs"]), len(clauses)
    finally:
        db.close()


def apply_supersession(db, new_doc_id: str, old_doc_ids: list[str]) -> int:
    """Mark old documents (and every clause under them) SUPERSEDED, closing
    their validity window at the new document's effective date. The vector
    store is resynced by the caller so retrieval hard-filters take effect."""
    from sqlalchemy import select

    new_doc = db.get(CorpusDoc, new_doc_id)
    if new_doc is None:
        raise ValueError(f"unknown doc {new_doc_id}")
    cutoff = new_doc.effective_date or ""
    changed = 0
    for old_id in old_doc_ids:
        old = db.get(CorpusDoc, old_id)
        if old is None:
            raise ValueError(f"unknown doc {old_id}")
        old.status = "SUPERSEDED"
        old.superseded_by = new_doc_id
        for cl in db.scalars(select(Clause).where(Clause.doc_id == old_id)).all():
            cl.status = "SUPERSEDED"
            cl.valid_to = cutoff
            changed += 1
    if old_doc_ids:
        new_doc.supersedes = sorted(set((new_doc.supersedes or []) + old_doc_ids))
    db.commit()
    return changed


def extract_draft(pdf_path: Path, regulator: str, doc_id: str) -> Path:
    """LLM-assisted clause segmentation: PDF -> draft JSON for human review."""
    import pdfplumber
    from openai import OpenAI

    settings = get_settings()
    with pdfplumber.open(pdf_path) as pdf:
        text = "\n".join(p.extract_text() or "" for p in pdf.pages)

    client = OpenAI(api_key=settings.openai_api_key)
    resp = client.chat.completions.create(
        model=settings.openai_model,
        response_format={"type": "json_object"},
        messages=[
            {
                "role": "system",
                "content": (
                    "You segment Indian financial regulatory documents into individual, "
                    "marketing/advertising-relevant clauses. Return JSON: "
                    '{"clauses": [{"clause_number": str, "text": str (VERBATIM from source), '
                    '"tags": [str], "mandatory": bool}]}. '
                    "Only include clauses relevant to advertisements, marketing, social media, "
                    "disclosures or communications. Text must be copied verbatim."
                ),
            },
            {"role": "user", "content": text[:100_000]},
        ],
    )
    draft = json.loads(resp.choices[0].message.content)
    for c in draft.get("clauses", []):
        c["id"] = f"{doc_id}/{c['clause_number'].replace(' ', '')}"
        c["doc_id"] = doc_id
    out_path = CORPUS_DIR / "processed" / f"draft-{doc_id.lower()}.json"
    out_path.write_text(json.dumps({"regulator": regulator, **draft}, indent=2, ensure_ascii=False))
    return out_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Corpus ingestion")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_load = sub.add_parser("load", help="Load clause registry JSON into DB")
    p_load.add_argument("--file", type=Path, default=REGISTRY_PATH)
    p_load.add_argument("--no-embed", action="store_true")

    p_ext = sub.add_parser("extract", help="Draft clause JSON from a PDF (needs review)")
    p_ext.add_argument("pdf", type=Path)
    p_ext.add_argument("--regulator", required=True)
    p_ext.add_argument("--doc-id", required=True)

    sub.add_parser("sync-qdrant", help="Rebuild the Qdrant collection from the DB registry")

    p_sup = sub.add_parser("supersede", help="Mark old docs SUPERSEDED by a new doc (temporal state)")
    p_sup.add_argument("new_doc_id")
    p_sup.add_argument("old_doc_ids", nargs="+")

    args = parser.parse_args()
    if args.cmd == "load":
        n_docs, n_clauses = load_registry(args.file, embed=not args.no_embed)
        print(f"Loaded {n_docs} docs, {n_clauses} clauses (embed={not args.no_embed})")
        if get_settings().retrieval_backend == "qdrant" and not args.no_embed:
            from app.core.db import get_session_factory
            from app.services.retrieval.qdrant_store import sync_from_db

            db = get_session_factory()()
            try:
                print(f"Synced {sync_from_db(db)} clauses to Qdrant")
            finally:
                db.close()
    elif args.cmd == "sync-qdrant":
        init_db()
        from app.core.db import get_session_factory
        from app.services.retrieval.qdrant_store import sync_from_db

        db = get_session_factory()()
        try:
            print(f"Synced {sync_from_db(db)} clauses to Qdrant")
        finally:
            db.close()
    elif args.cmd == "supersede":
        init_db()
        from app.core.db import get_session_factory

        db = get_session_factory()()
        try:
            n = apply_supersession(db, args.new_doc_id, args.old_doc_ids)
            print(f"Marked {len(args.old_doc_ids)} doc(s) / {n} clause(s) SUPERSEDED by {args.new_doc_id}")
            if get_settings().retrieval_backend == "qdrant":
                from app.services.retrieval.qdrant_store import sync_from_db

                print(f"Resynced {sync_from_db(db)} clauses to Qdrant")
        finally:
            db.close()
    elif args.cmd == "extract":
        out = extract_draft(args.pdf, args.regulator, args.doc_id)
        print(f"Draft written to {out} — review before merging into clauses.json")
        sys.exit(0)


if __name__ == "__main__":
    main()
