from pydantic_settings import BaseSettings
from pydantic import Field
from pathlib import Path


class Settings(BaseSettings):
    # ── Database ──────────────────────────────────────────────────────────────
    database_url: str = Field(..., env="DATABASE_URL")

    # ── Feature engineering ───────────────────────────────────────────────────
    min_gw_history: int = Field(5,  env="MIN_GW_HISTORY")
    rolling_window: int = Field(5,  env="ROLLING_WINDOW")
    target_gameweek: int | None = Field(None, env="TARGET_GAMEWEEK")

    # ── Artifact paths ────────────────────────────────────────────────────────
    models_dir:   Path = Field(Path("artifacts/models"),   env="MODELS_DIR")
    datasets_dir: Path = Field(Path("artifacts/datasets"), env="DATASETS_DIR")
    reports_dir:  Path = Field(Path("artifacts/reports"),  env="REPORTS_DIR")

    # ── Logging ───────────────────────────────────────────────────────────────
    log_level: str = Field("INFO", env="LOG_LEVEL")

    class Config:
        env_file = Path(__file__).parent / ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"

    def model_post_init(self, __context) -> None:
        # Anchor relative artifact paths to this directory (apps/ai) so the
        # pipeline writes to the same place no matter which working directory
        # it is launched from (repo root, apps/ai, or the API scheduler).
        root = Path(__file__).parent
        for name in ("models_dir", "datasets_dir", "reports_dir"):
            p = getattr(self, name)
            if not p.is_absolute():
                object.__setattr__(self, name, (root / p).resolve())

        # Normalize the DB URL for SQLAlchemy + psycopg3. When the API server
        # spawns the pipeline, its own Prisma-style DATABASE_URL
        # ("postgresql://...?schema=public") wins over apps/ai/.env:
        #   - without a driver suffix SQLAlchemy would try psycopg2 (absent)
        #   - psycopg rejects Prisma's "schema" query parameter
        from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

        url = self.database_url
        for prefix in ("postgresql://", "postgres://"):
            if url.startswith(prefix):
                url = "postgresql+psycopg://" + url[len(prefix):]
                break
        parts = urlsplit(url)
        if parts.query:
            query = [(k, v) for k, v in parse_qsl(parts.query) if k.lower() != "schema"]
            url = urlunsplit(parts._replace(query=urlencode(query)))
        object.__setattr__(self, "database_url", url)

    def ensure_artifact_dirs(self) -> None:
        """Creates artifact directories if they don't exist."""
        for d in [self.models_dir, self.datasets_dir, self.reports_dir]:
            d.mkdir(parents=True, exist_ok=True)


settings = Settings()