from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_DIR = BACKEND_DIR.parent
CORPUS_DIR = REPO_DIR / "corpus"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    app_name: str = "ComplianceCopilot"
    database_url: str = f"sqlite:///{BACKEND_DIR / 'compliance.db'}"

    # ---- LLM provider layer (Buildathon: Hermes primary, OpenAI preprocessing) ----
    # llm_provider: "hermes" | "openai". The system prefers Hermes for the agent
    # pipeline; falls back to OpenAI automatically when no Hermes key is set, so
    # the demo runs today and flips to Hermes the moment HERMES_API_KEY lands.
    llm_provider: str = "hermes"

    # Nous Hermes — OpenAI-compatible inference endpoint (or an OpenRouter route).
    hermes_api_key: str = ""
    hermes_base_url: str = "https://inference-api.nousresearch.com/v1"
    hermes_model: str = "Hermes-4-405B"

    # OpenAI (GPT-5.5) — heavy preprocessing: vision/OCR on complex PDF tables,
    # large-context distillation before handing refined context to Hermes.
    openai_api_key: str = ""
    openai_model: str = "gpt-5.1"
    openai_preprocess_model: str = "gpt-5.1"  # vision/large-context model
    openai_embedding_model: str = "text-embedding-3-small"

    # Cloudflare AI Gateway — when set, ALL LLM traffic is routed through the
    # gateway for latency tracking, caching and token accounting. Format:
    # https://gateway.ai.cloudflare.com/v1/<account_id>/<gateway>
    cf_ai_gateway_base: str = ""

    # ---- Convex (sole backend + vector store) ----
    convex_url: str = ""           # https://<deployment>.convex.cloud
    convex_site_url: str = ""      # https://<deployment>.convex.site (HTTP actions)
    convex_deploy_key: str = ""    # server-side mutations
    convex_ingest_token: str = ""  # shared secret for the bulkIngest HTTP action

    # ---- Linkup (real-time regulatory web search, called as a Hermes tool) ----
    linkup_api_key: str = ""
    linkup_base_url: str = "https://api.linkup.so/v1"

    # ---- ElevenLabs (voice copilot) ----
    elevenlabs_api_key: str = ""
    elevenlabs_voice_id: str = "JBFqnCBsd6RMkjVDRZzb"  # a calm, professional default
    elevenlabs_model: str = "eleven_turbo_v2_5"  # low-latency

    # ---- Razorpay (self-serve INR subscription, UPI AutoPay) ----
    razorpay_key_id: str = ""
    razorpay_key_secret: str = ""
    razorpay_webhook_secret: str = ""

    # ---- Single-tenant MVP auth / infra ----
    api_token: str = "dev-token"
    redis_url: str = "redis://localhost:6379/0"
    public_web_url: str = "http://localhost:4321"  # Astro dev server

    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_whatsapp_from: str = ""

    # ---- resolved helpers ----
    @property
    def use_hermes(self) -> bool:
        return self.llm_provider == "hermes" and bool(self.hermes_api_key)

    @property
    def agent_provider(self) -> str:
        """Which provider actually serves the agent pipeline right now."""
        return "hermes" if self.use_hermes else "openai"


@lru_cache
def get_settings() -> Settings:
    return Settings()
