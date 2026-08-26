from decimal import Decimal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Provided by the coders.kr platform via coders.yaml substitution.
    database_url: str = "postgresql+asyncpg://app:app@localhost:5432/app"
    database_pool_size: int = 10
    database_max_overflow: int = 20
    database_pool_timeout: int = 15
    database_pool_recycle: int = 900

    # Redis is optional in local development and mandatory in the production
    # manifest. It keeps hot public responses and abuse limits consistent when
    # more than one API process is serving traffic.
    redis_url: str | None = None
    leaderboard_cache_seconds: int = 15
    rate_limit_read_per_minute: int = 240
    rate_limit_write_per_minute: int = 30
    # All current API payloads are small JSON commands. Rejecting unexpectedly
    # large bodies before FastAPI parses them protects memory under abuse and
    # keeps a busy replica available for real users.
    max_request_body_bytes: int = 64_000

    # Optional publishable key from logo.dev. This key is intentionally safe
    # to include in image URLs returned to the browser.
    logo_dev_publishable_key: str | None = None

    # Local-dev escape hatch. Never set in production.
    dev_fake_user: str | None = None

    # KIS credentials stay on the API server. StockPilot uses them only for
    # market data; every user's cash, positions, and orders remain virtual and
    # are stored in our own database.
    kis_env: str = "paper"
    kis_app_key: str | None = None
    kis_app_secret: str | None = None
    kis_rest_calls_per_second: int = 1
    # Upper bound for a user-facing market-data request, including time spent
    # waiting behind the shared KIS REST limiter. Slow upstreams must not pin
    # an API worker indefinitely during a traffic spike.
    market_data_request_timeout_seconds: float = 8.0
    simulation_fee_rate: Decimal = Decimal("0.00015")
    simulation_kr_sell_tax_rate: Decimal = Decimal("0.002")
    trading_mode: str = "SIMULATION"
    market_data_max_age_seconds: int = 15
    risk_max_order_notional_krw: Decimal = Decimal("100000000")
    risk_max_order_notional_usd: Decimal = Decimal("100000")
    risk_max_open_orders: int = 20
    risk_max_daily_orders: int = 200
    risk_max_price_deviation_percent: Decimal = Decimal("30")

    # Comma-separated Google emails allowed to use the institutional console.
    # Keep this in deployment secrets; never hard-code an operator in Git.
    operator_emails: str = ""

    # OpenDART is used for Korean public-company profiles, financials, and
    # disclosures. The key never leaves the API server.
    dart_api_key: str | None = None

    # StockPilot runs in coders.kr standalone mode and owns its Google login.
    # Secrets are injected by the platform and never exposed to the browser.
    google_client_id: str | None = None
    google_client_secret: str | None = None
    google_redirect_uri: str = "https://stockpilot.coders.kr/api/auth/google/callback"
    auth_session_secret: str | None = None
    auth_cookie_secure: bool = True
    enable_api_docs: bool = False

    # Firebase Cloud Messaging sends browser notifications when a saved
    # StockPilot target price is reached. The service-account JSON is base64
    # encoded before it is stored in the deployment environment.
    firebase_service_account_b64: str | None = None

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()

