"""API-level tests: auth, review CRUD, audit PDF, WhatsApp webhook (LLM mocked)."""

import pytest
from fastapi.testclient import TestClient

import app.services.review_service as rs

AUTH = {"Authorization": "Bearer dev-token"}
NON_COMPLIANT = "Guaranteed 15% returns! Best fund ever. DM me."


@pytest.fixture()
def client(db, monkeypatch):
    async def fake_reviewer(llm, content, audience, channel, clauses, already):
        return []

    async def fake_adjudicator(llm, content, findings, clauses_by_id):
        return findings

    async def fake_rewriter(llm, content, audience, descs, arn, author_name=None):
        return {"rewrite": "compliant version", "summary": "issues fixed"}

    class FakeStore:
        async def search(self, query, audience, k=12):
            return []

    monkeypatch.setattr(rs, "run_reviewer", fake_reviewer)
    monkeypatch.setattr(rs, "run_adjudicator", fake_adjudicator)
    monkeypatch.setattr(rs, "run_rewriter", fake_rewriter)
    monkeypatch.setattr(rs, "get_store", lambda db: FakeStore())
    monkeypatch.setattr(rs, "LLMClient", lambda: None)

    from app.main import app

    with TestClient(app) as c:
        yield c


def test_review_requires_auth(client):
    r = client.post("/api/reviews", json={"content": "hello"})
    assert r.status_code == 401


def test_create_get_list_review(client):
    r = client.post("/api/reviews", json={"content": NON_COMPLIANT, "channel": "whatsapp"}, headers=AUTH)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["verdict"] == "fail"
    assert body["findings"] and all(f["clause_id"] for f in body["findings"])

    rid = body["id"]
    r2 = client.get(f"/api/reviews/{rid}", headers=AUTH)
    assert r2.status_code == 200 and r2.json()["id"] == rid

    r3 = client.get("/api/reviews", headers=AUTH)
    assert r3.status_code == 200 and any(item["id"] == rid for item in r3.json())


def test_audit_pdf_downloads(client):
    rid = client.post("/api/reviews", json={"content": NON_COMPLIANT}, headers=AUTH).json()["id"]
    r = client.get(f"/api/audit/{rid}/pdf", headers=AUTH)
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF")
    assert len(r.content) > 2000


def test_corpus_endpoints(client):
    docs = client.get("/api/corpus/docs", headers=AUTH).json()
    assert {d["id"] for d in docs} >= {"SEBI-ADCODE-2023", "AMFI-COC-2022"}
    clauses = client.get("/api/corpus/clauses", headers=AUTH, params={"doc_id": "SEBI-ADCODE-2023"}).json()
    assert len(clauses) >= 15


def test_whatsapp_webhook_replies_twiml(client):
    r = client.post("/webhooks/whatsapp", data={"Body": NON_COMPLIANT, "From": "whatsapp:+919999999999"})
    assert r.status_code == 200
    assert "application/xml" in r.headers["content-type"]
    assert "<Message>" in r.text and "Do NOT post" in r.text
