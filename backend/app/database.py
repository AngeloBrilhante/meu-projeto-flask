import mysql.connector
from contextlib import contextmanager
from app.config.settings import DB_CONFIG


def get_db():
    """
    Cria e retorna uma conexão com o banco MySQL
    """
    return mysql.connector.connect(
        host=DB_CONFIG["host"],
        user=DB_CONFIG["user"],
        password=DB_CONFIG["password"],
        database=DB_CONFIG["database"],
        port=DB_CONFIG.get("port", 3306),
        autocommit=False  # Controle manual de transação
    )


@contextmanager
def db_cursor(dictionary=False):
    """
    Gerencia conexão, commit, rollback e fechamento automático.
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
