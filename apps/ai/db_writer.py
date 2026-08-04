import pandas as pd
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from config import settings
from logging_utils import get_logger

logger = get_logger(__name__)

_engine: Engine | None = None


def get_writer_engine() -> Engine:
    global _engine
    if _engine is None:
        _engine = create_engine(
            settings.database_url,
            pool_pre_ping=True,
            pool_size=3,
        )
    return _engine


def upsert_dataframe(
    df: pd.DataFrame,
    table_name: str,
    conflict_columns: list[str],
) -> int:
    """
    Upserts a DataFrame into a Postgres table using INSERT ... ON CONFLICT DO UPDATE.
    Returns the number of rows processed.
    """
    if df.empty:
        logger.warning(f"upsert_dataframe called with empty DataFrame for {table_name}")
        return 0

    engine = get_writer_engine()
    cols   = df.columns.tolist()

    
    update_cols = [c for c in cols if c not in conflict_columns]
    update_set  = ", ".join(f"{c} = EXCLUDED.{c}" for c in update_cols)
    conflict_on = ", ".join(conflict_columns)

    placeholders = ", ".join(f":{c}" for c in cols)
    col_list     = ", ".join(cols)

    sql = f"""
        INSERT INTO {table_name} ({col_list})
        VALUES ({placeholders})
        ON CONFLICT ({conflict_on})
        DO UPDATE SET {update_set}
    """

    rows = df.to_dict(orient="records")
    with engine.begin() as conn:
        conn.execute(text(sql), rows)

    logger.info(f"Upserted {len(rows)} rows into {table_name}")
    return len(rows)


def dispose() -> None:
    global _engine
    if _engine:
        _engine.dispose()
        _engine = None