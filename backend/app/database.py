import mysql.connector
from contextlib import contextmanager
from mysql.connector import pooling

from app.config.settings import DB_CONFIG

_pool = None


def _get_pool():
    # Lazily built on first request (not at import time) so a DB outage at
    # worker boot doesn't crash the whole process before it can even serve
    # /api/health. connection_timeout bounds a stuck handshake instead of
    # hanging the sync worker until gunicorn's 30s WORKER TIMEOUT kills it.
    global _pool
    if _pool is None:
        _pool = pooling.MySQLConnectionPool(
            pool_name="consignado_pool",
            pool_size=5,
            pool_reset_session=True,
            connection_timeout=10,
            host=DB_CONFIG["host"],
            user=DB_CONFIG["user"],
            password=DB_CONFIG["password"],
            database=DB_CONFIG["database"],
            port=DB_CONFIG.get("port", 3306),
            charset="utf8mb4",
            collation="utf8mb4_unicode_ci",
            use_unicode=True,
            autocommit=False,
        )
    return _pool


def get_db():
    """
    Returns a pooled MySQL connection.
    """
    return _get_pool().get_connection()


@contextmanager
def db_cursor(dictionary=False):
    """
    Manages connection lifecycle with automatic commit/rollback.
    """
    db = get_db()
    cursor = db.cursor(dictionary=dictionary)

    try:
        yield cursor
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        cursor.close()
        db.close()

