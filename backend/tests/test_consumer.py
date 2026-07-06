"""Consumer pipeline test against a real source PDF (native extraction path)."""

from pathlib import Path

from app.core.config import CORPUS_DIR
from app.services.corpus.cascade import extract_text_cascade
from app.workers.consumer import process_job

SAMPLE_PDF = CORPUS_DIR / "sources" / "sebi-adcode-2023.pdf"


def test_cascade_native_path():
    text, method = extract_text_cascade(SAMPLE_PDF)
    assert method == "native"
    assert "Advertisement code" in text


def test_process_job_produces_draft_and_event(db, tmp_path):
    job = {
        "pdf_path": str(SAMPLE_PDF),
        "url": "https://www.sebi.gov.in/test/adcode.pdf",
        "regulator": "SEBI",
        "sha256": "t" * 64,
        "downloaded_at": "2026-07-06T00:00:00Z",
    }
    event = process_job(job)
    assert event is not None
    assert event.n_chunks > 3
    assert event.extraction_method == "native"
    draft = Path(event.draft_path)
    assert draft.exists()
    # every chunk force-tagged with provenance
    import json

    data = json.loads(draft.read_text())
    assert all(ch["metadata"]["regulator"] == "SEBI" for ch in data["chunks"])
    draft.unlink()

    # idempotent on redelivery
    assert process_job(job) is None
