import mysql.connector
from contextlib import contextmanager

from app.config.settings import DB_CONFIG


def get_db():
    """
    Creates and returns a MySQL connection.
    """
    return mysql.connector.connect(
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

