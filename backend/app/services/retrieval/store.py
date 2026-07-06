"""Clause retrieval.

`RetrievalStore` is the adapter seam: the MVP implementation embeds the query
via OpenAI and does cosine similarity over clause embeddings held in SQLite —
fine for a few hundred clauses. Stage 2/3 swaps in a vector DB (Qdrant/Milvus)
with payload filtering behind the same interface; callers never change.

Audience pre-filtering happens here (audience:mfd vs audience:ia-ra tags), so
retrieval can never leak another regulator's clauses into a review — the same
zero-cross-contamination guarantee a vector DB payload filter would give.
Mandatory clauses for the audience are always unioned into the result set.
"""

from dataclasses import dataclass
from typing import Protocol

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import Clause


@dataclass
class RetrievedClause:
    id: str
    clause_number: str
    doc_id: str
    text: str
    tags: list[str]
    mandatory: bool
    score: float


class RetrievalStore(Protocol):
    async def search(self, query: str, audience: str, k: int = 12) -> list[RetrievedClause]: ...


def _audience_tag(audience: str) -> str:
    return f"audience:{audience}"


async def embed_query(query: str) -> np.ndarray:
    from openai import AsyncOpenAI

    settings = get_settings()
    client = AsyncOpenAI(api_key=settings.openai_api_key)
    resp = await client.embeddings.create(
        model=settings.openai_embedding_model, input=[query]
    )
    return np.array(resp.data[0].embedding, dtype=np.float32)


class SqliteNumpyStore:
    def __init__(self, db: Session):
        self.db = db

    def _audience_clauses(self, audience: str) -> list[Clause]:
        tag = _audience_tag(audience)
        return [c for c in self.db.scalars(select(Clause)).all() if tag in (c.tags or [])]

    async def search(self, query: str, audience: str, k: int = 12) -> list[RetrievedClause]:
        clauses = self._audience_clauses(audience)
        if not clauses:
            return []

        scored: dict[str, tuple[Clause, float]] = {}
        embeddable = [c for c in clauses if c.embedding]
        if embeddable:
            qvec = await embed_query(query)
            qvec = qvec / (np.linalg.norm(qvec) or 1.0)
            mat = np.stack([np.frombuffer(c.embedding, dtype=np.float32) for c in embeddable])
            norms = np.linalg.norm(mat, axis=1)
            norms[norms == 0] = 1.0
            sims = (mat @ qvec) / norms
            order = np.argsort(-sims)[:k]
            for i in order:
                c = embeddable[int(i)]
                scored[c.id] = (c, float(sims[int(i)]))

        # Mandatory clauses are always in the review set, embedded or not.
        for c in clauses:
            if c.mandatory and c.id not in scored:
                scored[c.id] = (c, 0.0)

        return [
            RetrievedClause(
                id=c.id,
                clause_number=c.clause_number,
                doc_id=c.doc_id,
                text=c.text,
                tags=c.tags or [],
                mandatory=c.mandatory,
                score=round(s, 4),
            )
            for c, s in sorted(scored.values(), key=lambda t: (-t[0].mandatory, -t[1]))
        ]


def get_store(db: Session) -> RetrievalStore:
    settings = get_settings()
    if settings.retrieval_backend == "qdrant":
        from app.services.retrieval.qdrant_store import QdrantStore

        return QdrantStore(db)
    return SqliteNumpyStore(db)
