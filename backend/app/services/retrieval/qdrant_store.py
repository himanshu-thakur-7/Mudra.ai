"""Qdrant retrieval backend with payload-filtered search.

The audience/regulator pre-filter runs INSIDE the vector engine (Qdrant
payload filter), so a query for MFD WhatsApp content can never surface an RBI
lending clause — zero cross-regulator contamination by construction, exactly
the guarantee the SqliteNumpyStore provides in Python.

Local embedded mode (path=...) for dev; point QdrantClient at a server URL in
production — nothing else changes.
"""

import uuid

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import Clause
from app.services.retrieval.store import RetrievedClause, _audience_tag, embed_query

COLLECTION = "clauses"

_client = None  # embedded-mode client is process-wide (local storage is single-writer)


def _get_client():
    global _client
    if _client is None:
        from qdrant_client import QdrantClient

        _client = QdrantClient(path=get_settings().qdrant_path)
    return _client


def _point_id(clause_id: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, clause_id))


def sync_from_db(db: Session) -> int:
    """Rebuild the collection from the clause registry in SQLAlchemy."""
    from qdrant_client.models import Distance, PointStruct, VectorParams

    clauses = [c for c in db.scalars(select(Clause)).all() if c.embedding]
    if not clauses:
        return 0
    client = _get_client()
    dim = len(np.frombuffer(clauses[0].embedding, dtype=np.float32))
    if client.collection_exists(COLLECTION):
        client.delete_collection(COLLECTION)
    client.create_collection(COLLECTION, vectors_config=VectorParams(size=dim, distance=Distance.COSINE))
    client.upsert(COLLECTION, points=[
        PointStruct(
            id=_point_id(c.id),
            vector=np.frombuffer(c.embedding, dtype=np.float32).tolist(),
            payload={
                "clause_id": c.id,
                "doc_id": c.doc_id,
                "clause_number": c.clause_number,
                "text": c.text,
                "tags": c.tags or [],
                "mandatory": c.mandatory,
            },
        )
        for c in clauses
    ])
    return len(clauses)


class QdrantStore:
    def __init__(self, db: Session):
        self.db = db  # kept for interface parity; mandatory-union reads Qdrant payloads

    async def search(self, query: str, audience: str, k: int = 12) -> list[RetrievedClause]:
        from qdrant_client.models import FieldCondition, Filter, MatchValue

        client = _get_client()
        audience_filter = Filter(must=[
            FieldCondition(key="tags", match=MatchValue(value=_audience_tag(audience)))
        ])

        qvec = await embed_query(query)
        hits = client.query_points(
            COLLECTION, query=qvec.tolist(), query_filter=audience_filter, limit=k,
            with_payload=True,
        ).points

        results: dict[str, RetrievedClause] = {}
        for h in hits:
            p = h.payload
            results[p["clause_id"]] = RetrievedClause(
                id=p["clause_id"], clause_number=p["clause_number"], doc_id=p["doc_id"],
                text=p["text"], tags=p["tags"], mandatory=p["mandatory"],
                score=round(float(h.score), 4),
            )

        # Mandatory clauses for this audience are always in the review set.
        mandatory_filter = Filter(must=[
            FieldCondition(key="tags", match=MatchValue(value=_audience_tag(audience))),
            FieldCondition(key="mandatory", match=MatchValue(value=True)),
        ])
        points, _ = client.scroll(COLLECTION, scroll_filter=mandatory_filter, limit=256, with_payload=True)
        for pt in points:
            p = pt.payload
            if p["clause_id"] not in results:
                results[p["clause_id"]] = RetrievedClause(
                    id=p["clause_id"], clause_number=p["clause_number"], doc_id=p["doc_id"],
                    text=p["text"], tags=p["tags"], mandatory=p["mandatory"], score=0.0,
                )

        return sorted(results.values(), key=lambda c: (-c.mandatory, -c.score))
