from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Gmail
    gmail_credentials_file: str = "credentials.json"
    gmail_token_file: str = "token.json"
    gmail_sender_email: str = ""

    # Gong
    gong_api_base_url: str = "https://us-11211.api.gong.io"
    gong_access_key: str = ""
    gong_access_key_secret: str = ""

    # Demo mode (runs without real API keys)
    demo_mode: bool = True

    # Nurture settings
    nurture_check_interval_hours: int = 24
    nurture_days_before_close: int = 90
    nurture_email_interval_days: int = 7

    # Database
    database_url: str = "sqlite+aiosqlite:///./sales_pipeline.db"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
