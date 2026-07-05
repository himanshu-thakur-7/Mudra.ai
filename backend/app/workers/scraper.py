"""Stage-2 living-knowledge-base ingestion — skeleton only.

Target architecture (see docs/ARCHITECTURE.md):
- Go worker fleet monitors regulator circular listing pages concurrently;
  a Redis token-bucket rate limiter caps per-domain request rates.
- Change detection: hash the listing page DOM state / HTTP headers; on change,
  push a download job to a message broker; PDFs land in object storage.
- This Python service consumes those payloads: cascade extraction
  (pdfplumber -> OCR for scanned docs), legal-structure chunking via
  app/services/corpus/ingest.py, metadata tagging, embedding, and a
  change-alert to affected orgs.

The functions below define the seam so the MVP codebase compiles against the
future pipeline; none of them are wired to a scheduler yet.
"""

REGULATOR_LISTING_PAGES = {
    "SEBI": "https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=1&ssid=7&smid=0",
    "AMFI": "https://www.amfiindia.com/mutual-fund-distributors/circulars-for-distributors",
}


def detect_changes(regulator: str) -> list[str]:
    """Return URLs of new/changed circulars since the last snapshot hash."""
    raise NotImplementedError("Stage 2: implemented by the Go ingestion fleet")


def process_new_circular(pdf_url: str, regulator: str) -> None:
    """Download -> cascade-extract -> draft clauses -> queue for human review."""
    raise NotImplementedError(
        "Stage 2: route through app.services.corpus.ingest.extract_draft"
    )
