"""Mudra.ai ingestion worker.

The Python backend's ONLY job is to parse messy regulator PDFs and push clean,
structured, layout-aware chunks into Convex. All orchestration, vector search,
and reactive state live in Convex (see convex/). This service therefore mounts
only the ingestion + commercial-support routers — it does not run agents.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.db import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=f"{settings.app_name} · ingestion worker", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:4321", "http://127.0.0.1:4321",  # Astro app
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    from app.api import billing, corpus, ingestion, system

    app.include_router(corpus.router, prefix="/api")       # rulebook read/search of the local seed DB
    app.include_router(ingestion.router, prefix="/api")    # PDF fleet + Linkup + Convex push status
    app.include_router(billing.router, prefix="/api")      # Razorpay UPI AutoPay
    app.include_router(system.router, prefix="/api")       # partner status

    @app.get("/health")
    def health():
        return {"status": "ok", "role": "ingestion-worker", "app": settings.app_name}

    return app


app = create_app()
