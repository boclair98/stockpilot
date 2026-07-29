from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Provided by the coders.kr platform via coders.yaml substitution.
    database_url: str = "postgresql+asyncpg://app:app@localhost:5432/app"

    # Local-dev escape hatch. Never set in production.
    dev_fake_user: str | None = None

    # KIS credentials stay on the API server. StockPilot uses them only for
    # market data; every user's cash, positions, and orders remain virtual and
    # are stored in our own database.
    kis_env: str = "paper"
    kis_app_key: str | None = None
    kis_app_secret: str | None = None

    # OpenDART is used for Korean public-company profiles, financials, and
    # disclosures. The key never leaves the API server.
    dart_api_key: str | None = None

    # StockPilot runs in coders.kr standalone mode and owns its Google login.
    # Secrets are injected by the platform and never exposed to the browser.
    google_client_id: str | None = None
    google_client_secret: str | None = None
    google_redirect_uri: str = (
        "https://stockpilot.coders.kr/api/auth/google/callback"
    )
    auth_session_secret: str | None = None
    auth_cookie_secure: bool = True

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
