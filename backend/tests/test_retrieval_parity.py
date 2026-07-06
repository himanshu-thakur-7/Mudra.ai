"""Sqlite and Qdrant retrieval backends must agree: same audience filtering,
same mandatory-union, same ranking — synthetic vectors, no network."""

import numpy as np
import pytest

import app.services.retrieval.store as store_mod
from app.models import Clause
from app.services.retrieval.qdrant_store import QdrantStore, sync_from_db
from app.services.retrieval.store import SqliteNumpyStore

DIM = 8


def _vec(hot: int) -> np.ndarray:
    v = np.zeros(DIM, dtype=np.float32)
    v[hot] = 1.0
    return v


@pytest.fixture()
def synthetic_clauses(db, tmp_path, monkeypatch):
    from app.core import config

    monkeypatch.setenv("QDRANT_PATH", str(tmp_path / "qdrant"))
    config.get_settings.cache_clear()
    import app.services.retrieval.qdrant_store as qmod

    monkeypatch.setattr(qmod, "_client", None)  # fresh embedded client per test

    db.query(Clause).delete()
    rows = [
        Clause(id="MFD/near", doc_id="AMFI-COC-2022", clause_number="n1",
               text="near clause", tags=["audience:mfd"], mandatory=False, embedding=_vec(0).tobytes()),
        Clause(id="MFD/far", doc_id="AMFI-COC-2022", clause_number="f1",
               text="far clause", tags=["audience:mfd"], mandatory=False,
               # small positive similarity to the query so ranking has no ties
               embedding=(0.3 * _vec(0) + _vec(5)).astype(np.float32).tobytes()),
        Clause(id="MFD/mandatory", doc_id="AMFI-COC-2022", clause_number="m1",
               text="mandatory clause", tags=["audience:mfd"], mandatory=True, embedding=_vec(6).tobytes()),
        Clause(id="IARA/near", doc_id="SEBI-ADCODE-2023", clause_number="x1",
               text="ia-ra clause near the query", tags=["audience:ia-ra"], mandatory=False,
               embedding=_vec(0).tobytes()),
    ]
    db.add_all(rows)
    db.commit()

    async def fake_embed(query: str) -> np.ndarray:
        return _vec(0)

    monkeypatch.setattr(store_mod, "embed_query", fake_embed)
    monkeypatch.setattr(qmod, "embed_query", fake_embed)
    sync_from_db(db)
    return db


async def test_backends_agree_on_filtering_ranking_and_mandatory_union(synthetic_clauses):
    db = synthetic_clauses
    sq = await SqliteNumpyStore(db).search("query", audience="mfd", k=2)
    qd = await QdrantStore(db).search("query", audience="mfd", k=2)

    sq_ids, qd_ids = [c.id for c in sq], [c.id for c in qd]
    # zero cross-audience contamination in both
    assert "IARA/near" not in sq_ids and "IARA/near" not in qd_ids
    # mandatory clause always unioned in, ranked first, in both
    assert sq_ids[0] == "MFD/mandatory" and qd_ids[0] == "MFD/mandatory"
    # nearest clause retrieved by both
    assert "MFD/near" in sq_ids and "MFD/near" in qd_ids
    assert set(sq_ids) == set(qd_ids)


async def test_qdrant_filters_ia_ra_queries_symmetrically(synthetic_clauses):
    qd = await QdrantStore(synthetic_clauses).search("query", audience="ia-ra", k=4)
    assert [c.id for c in qd] == ["IARA/near"]
