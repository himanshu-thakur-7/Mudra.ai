import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture()
def db(tmp_path, monkeypatch):
    """Fresh SQLite DB per test, clause registry loaded without embeddings."""
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'test.db'}")

    from app.core import config, db as db_mod

    config.get_settings.cache_clear()
    db_mod._engine = None
    db_mod._SessionLocal = None

    from app.services.corpus.ingest import load_registry

    load_registry(embed=False)
    session = db_mod.get_session_factory()()
    yield session
    session.close()
    config.get_settings.cache_clear()
    db_mod._engine = None
    db_mod._SessionLocal = None


@pytest.fixture()
def seeded_user(db):
    from app.core.auth import seed_default_user

    return seed_default_user(db)


def pytest_configure(config):
    config.addinivalue_line("markers", "llm: hits the live OpenAI API (set RUN_LLM_TESTS=1)")


def pytest_collection_modifyitems(config, items):
    if os.environ.get("RUN_LLM_TESTS") == "1":
        return
    skip = pytest.mark.skip(reason="live LLM test; set RUN_LLM_TESTS=1 to run")
    for item in items:
        if "llm" in item.keywords:
            item.add_marker(skip)
