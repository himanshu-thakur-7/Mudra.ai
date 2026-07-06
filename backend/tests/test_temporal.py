"""Temporal architecture: SUPERSEDED clauses must be invisible to retrieval
in BOTH backends, and supersession must close validity windows."""

import numpy as np
import pytest

import app.services.retrieval.store as store_mod
from app.models import Clause, CorpusDoc
from app.services.corpus.ingest import apply_supersession
from app.services.retrieval.qdrant_store import QdrantStore, sync_from_db
from app.services.retrieval.store import SqliteNumpyStore

DIM = 8


def _vec(hot: int) -> np.ndarray:
    v = np.zeros(DIM, dtype=np.float32)
    v[hot] = 1.0
    return v


@pytest.fixture()
def temporal_db(db, tmp_path, monkeypatch):
    from app.core import config

    monkeypatch.setenv("QDRANT_PATH", str(tmp_path / "qdrant"))
    config.get_settings.cache_clear()
    import app.services.retrieval.qdrant_store as qmod

    monkeypatch.setattr(qmod, "_client", None)

    db.query(Clause).delete()
    db.add(CorpusDoc(id="OLD-GUIDELINES-2022", regulator="RBI", title="Old guidelines",
                     effective_date="2022-09-02"))
    db.add_all([
        Clause(id="NEW/rule", doc_id="RBI-DLD-2025", clause_number="n1",
               text="active new rule", tags=["audience:nbfc-lsp"], mandatory=False,
               status="ACTIVE", valid_from="2025-05-08", embedding=_vec(0).tobytes()),
        Clause(id="OLD/rule", doc_id="OLD-GUIDELINES-2022", clause_number="o1",
               text="obsolete old rule, extremely similar to the query",
               tags=["audience:nbfc-lsp"], mandatory=False,
               status="ACTIVE", valid_from="2022-09-02", embedding=_vec(0).tobytes()),
    ])
    db.commit()

    async def fake_embed(query: str) -> np.ndarray:
        return _vec(0)

    monkeypatch.setattr(store_mod, "embed_query", fake_embed)
    monkeypatch.setattr(qmod, "embed_query", fake_embed)
    return db


async def test_superseded_clauses_invisible_in_both_backends(temporal_db):
    db = temporal_db
    # Before supersession: both rules retrievable.
    ids = {c.id for c in await SqliteNumpyStore(db).search("q", audience="nbfc-lsp", k=5)}
    assert ids == {"NEW/rule", "OLD/rule"}

    changed = apply_supersession(db, "RBI-DLD-2025", ["OLD-GUIDELINES-2022"])
    assert changed == 1
    sync_from_db(db)

    sq = {c.id for c in await SqliteNumpyStore(db).search("q", audience="nbfc-lsp", k=5)}
    qd = {c.id for c in await QdrantStore(db).search("q", audience="nbfc-lsp", k=5)}
    assert sq == {"NEW/rule"}, "sqlite backend must hard-filter SUPERSEDED"
    assert qd == {"NEW/rule"}, "qdrant backend must hard-filter SUPERSEDED"


def test_supersession_closes_validity_window(temporal_db):
    db = temporal_db
    apply_supersession(db, "RBI-DLD-2025", ["OLD-GUIDELINES-2022"])
    old = db.get(Clause, "OLD/rule")
    assert old.status == "SUPERSEDED"
    assert old.valid_to == "2025-05-08"  # closed at the new doc's effective date
    old_doc = db.get(CorpusDoc, "OLD-GUIDELINES-2022")
    assert old_doc.status == "SUPERSEDED" and old_doc.superseded_by == "RBI-DLD-2025"
