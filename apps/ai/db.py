import pandas as pd
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from config import settings
from logging_utils import get_logger

logger = get_logger(__name__)

_engine: Engine | None = None


def get_engine() -> Engine:
    """Returns a singleton SQLAlchemy engine (lazy init)."""
    global _engine
    if _engine is None:
        logger.info("Connecting to database...")
        _engine = create_engine(
            settings.database_url,
            pool_pre_ping=True,    
            pool_size=5,
            max_overflow=2,
        )
        logger.info("Database engine created.")
    return _engine


def read_sql(query: str, params: dict | None = None) -> pd.DataFrame:
    """
    Executes a read-only SQL query and returns a DataFrame.

    Usage:
        df = read_sql("SELECT * FROM fpl_players WHERE status = :status",
                      {"status": "a"})
    """
    engine = get_engine()
    with engine.connect() as conn:
        return pd.read_sql(text(query), conn, params=params or {})


def dispose() -> None:
    """Closes all connections in the pool. Call at end of script."""
    global _engine
    if _engine:
        _engine.dispose()
        _engine = None
        logger.info("Database engine disposed.")