from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_DIR = BACKEND_DIR.parent
CORPUS_DIR = REPO_DIR / "corpus"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    app_name: str = "AI Compliance Officer"
    database_url: str = f"sqlite:///{BACKEND_DIR / 'compliance.db'}"

    openai_api_key: str = ""
    openai_model: str = "gpt-5.1"
    openai_embedding_model: str = "text-embedding-3-small"

    # Single-tenant MVP auth: one bearer token for the seeded org.
    api_token: str = "dev-token"

    redis_url: str = "redis://localhost:6379/0"

    # Retrieval backend: "sqlite" (numpy cosine) or "qdrant" (payload-filtered vector DB).
    retrieval_backend: str = "sqlite"
    qdrant_path: str = str(BACKEND_DIR / ".qdrant")

    # Base URL used in WhatsApp replies to link back to the web result page.
    public_web_url: str = "http://localhost:5173"

    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_whatsapp_from: str = ""  # e.g. "whatsapp:+14155238886" (sandbox)

    razorpay_key_id: str = ""
    razorpay_key_secret: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
