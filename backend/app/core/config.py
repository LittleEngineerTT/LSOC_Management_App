from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="LSOC_", extra="ignore")
    database_url: str = "postgresql+psycopg://lsoc:lsoc@localhost:5433/lsoc"
    environment: str = "development"
    secret_key: str = "development-only-change-this-secret-before-deployment"
    frontend_url: str = "http://localhost:5173"
    cors_origins: list[str] = ["http://localhost:5173"]
    cookie_secure: bool = False
    session_hours: int = 24
    smtp_host: str = "localhost"
    smtp_port: int = 1025
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_starttls: bool = False
    smtp_from: str = "LSOC <noreply@lsoc.local>"
    worker_poll_seconds: int = 10
    ffvb_interval_minutes: int = 15
    match_before_minutes: int = 75
    match_after_minutes: int = 150
    match_courts: int = 3

    @model_validator(mode="after")
    def production(self) -> "Settings":
        if self.environment == "production":
            if self.secret_key.startswith("development-") or len(self.secret_key) < 32:
                raise ValueError(
                    "LSOC_SECRET_KEY doit être un secret aléatoire de 32 caractères minimum"
                )
            if not self.cookie_secure or not self.frontend_url.startswith("https://"):
                raise ValueError("La production exige HTTPS et LSOC_COOKIE_SECURE=true")
        return self


settings = Settings()
