import re
import unicodedata

from flask_jwt_extended import get_jwt, get_jwt_identity

from app.database import get_db

DEFAULT_COMPANY_NAME = "JRCRED"
DEFAULT_COMPANY_SLUG = "jrcred"


def normalize_company_slug(value):
    text = str(value or "").strip().lower()
    if not text:
        return ""

    text = unicodedata.normalize("NFKD", text)
    text = "".join(char for char in text if not unicodedata.combining(char))
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = re.sub(r"-{2,}", "-", text).strip("-")
    return text[:80]


def ensure_companies_table(cursor, db):
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS empresas (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nome VARCHAR(150) NOT NULL,
            slug VARCHAR(80) NOT NULL,
            logo_url VARCHAR(255) NULL,
            cor_primaria VARCHAR(20) NULL,
            cor_secundaria VARCHAR(20) NULL,
            ativa TINYINT(1) NOT NULL DEFAULT 1,
            criado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_empresas_slug (slug)
        )
        """
    )
    db.commit()


def get_or_create_default_company(cursor, db):
    ensure_companies_table(cursor, db)
    cursor.execute(
        """
        SELECT *
        FROM empresas
        WHERE slug = %s
        LIMIT 1
        """,
        (DEFAULT_COMPANY_SLUG,),
    )
    row = cursor.fetchone()
    if row:
        return row

    cursor.execute(
        """
        INSERT INTO empresas (
            nome,
            slug,
            cor_primaria,
            cor_secundaria,
            ativa
        )
        VALUES (%s, %s, %s, %s, 1)
        """,
        (DEFAULT_COMPANY_NAME, DEFAULT_COMPANY_SLUG, "#0d2b5c", "#4f7cff"),
    )
    db.commit()

    cursor.execute(
        """
        SELECT *
        FROM empresas
        WHERE id = %s
        LIMIT 1
        """,
        (cursor.lastrowid,),
    )
    return cursor.fetchone()


def ensure_company_scope_columns(cursor, db):
    default_company = get_or_create_default_company(cursor, db)
    default_company_id = int((default_company or {}).get("id") or 1)
    changed = False

    cursor.execute(
        """
        SELECT TABLE_NAME
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
        """
    )
    existing_tables = {row.get("TABLE_NAME") for row in cursor.fetchall()}

    def get_columns(table_name):
        if table_name not in existing_tables:
            return set()
        cursor.execute(
            """
            SELECT COLUMN_NAME
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = %s
            """,
            (table_name,),
        )
        return {row.get("COLUMN_NAME") for row in cursor.fetchall()}

    table_columns = {
        table_name: get_columns(table_name)
        for table_name in (
            "usuarios",
            "clientes",
            "operacoes",
            "dashboard_goals",
            "documentos",
            "operation_comments",
            "operation_notifications",
            "operation_status_history",
        )
        if table_name in existing_tables
    }

    def add_company_column(table_name):
        nonlocal changed
        columns = table_columns.get(table_name, set())
        if "empresa_id" in columns:
            return
        cursor.execute(f"ALTER TABLE {table_name} ADD COLUMN empresa_id INT NULL")
        columns.add("empresa_id")
        table_columns[table_name] = columns
        changed = True

    for table_name in table_columns:
        add_company_column(table_name)

    if "usuarios" in table_columns:
        cursor.execute(
            """
            UPDATE usuarios
            SET empresa_id = %s
            WHERE empresa_id IS NULL OR empresa_id = 0
            """,
            (default_company_id,),
        )
        changed = changed or cursor.rowcount > 0

    if "clientes" in table_columns and "usuarios" in table_columns:
        cursor.execute(
            """
            UPDATE clientes c
            JOIN usuarios u ON u.id = c.vendedor_id
            SET c.empresa_id = COALESCE(u.empresa_id, %s)
            WHERE c.empresa_id IS NULL OR c.empresa_id = 0
            """,
            (default_company_id,),
        )
        changed = changed or cursor.rowcount > 0

    if "operacoes" in table_columns and "clientes" in table_columns:
        cursor.execute(
            """
            UPDATE operacoes o
            JOIN clientes c ON c.id = o.cliente_id
            SET o.empresa_id = COALESCE(c.empresa_id, %s)
            WHERE o.empresa_id IS NULL OR o.empresa_id = 0
            """,
            (default_company_id,),
        )
        changed = changed or cursor.rowcount > 0

    if "documentos" in table_columns and "seller_id" in table_columns.get("documentos", set()):
        cursor.execute(
            """
            UPDATE documentos d
            LEFT JOIN clientes c ON c.id = d.client_id
            LEFT JOIN usuarios u ON u.id = d.seller_id
            SET d.empresa_id = COALESCE(c.empresa_id, u.empresa_id, %s)
            WHERE d.empresa_id IS NULL OR d.empresa_id = 0
            """,
            (default_company_id,),
        )
        changed = changed or cursor.rowcount > 0

    if "dashboard_goals" in table_columns:
        cursor.execute(
            """
            UPDATE dashboard_goals dg
            LEFT JOIN usuarios u ON u.id = NULLIF(dg.vendedor_id, 0)
            LEFT JOIN usuarios uu ON uu.id = dg.updated_by
            SET dg.empresa_id = COALESCE(u.empresa_id, uu.empresa_id, %s)
            WHERE dg.empresa_id IS NULL OR dg.empresa_id = 0
            """,
            (default_company_id,),
        )
        changed = changed or cursor.rowcount > 0

    if "operation_comments" in table_columns and "operacoes" in table_columns:
        cursor.execute(
            """
            UPDATE operation_comments oc
            JOIN operacoes o ON o.id = oc.operation_id
            SET oc.empresa_id = COALESCE(o.empresa_id, %s)
            WHERE oc.empresa_id IS NULL OR oc.empresa_id = 0
            """,
            (default_company_id,),
        )
        changed = changed or cursor.rowcount > 0

    if "operation_notifications" in table_columns and "operacoes" in table_columns:
        cursor.execute(
            """
            UPDATE operation_notifications onf
            JOIN operacoes o ON o.id = onf.operation_id
            SET onf.empresa_id = COALESCE(o.empresa_id, %s)
            WHERE onf.empresa_id IS NULL OR onf.empresa_id = 0
            """,
            (default_company_id,),
        )
        changed = changed or cursor.rowcount > 0

    if "operation_status_history" in table_columns and "operacoes" in table_columns:
        cursor.execute(
            """
            UPDATE operation_status_history osh
            JOIN operacoes o ON o.id = osh.operation_id
            SET osh.empresa_id = COALESCE(o.empresa_id, %s)
            WHERE osh.empresa_id IS NULL OR osh.empresa_id = 0
            """,
            (default_company_id,),
        )
        changed = changed or cursor.rowcount > 0

    if "dashboard_goals" in table_columns:
        cursor.execute(
            """
            SELECT INDEX_NAME
            FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'dashboard_goals'
              AND NON_UNIQUE = 0
            """
        )
        unique_indexes = {row.get("INDEX_NAME") for row in cursor.fetchall()}
        if "uk_dashboard_goal_scope" in unique_indexes:
            cursor.execute("ALTER TABLE dashboard_goals DROP INDEX uk_dashboard_goal_scope")
            changed = True

        cursor.execute(
            """
            SELECT 1
            FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'dashboard_goals'
              AND INDEX_NAME = 'uk_dashboard_goal_scope_company'
            LIMIT 1
            """
        )
        if cursor.fetchone() is None:
            cursor.execute(
                """
                CREATE UNIQUE INDEX uk_dashboard_goal_scope_company
                ON dashboard_goals (empresa_id, year, month, vendedor_id)
                """
            )
            changed = True

    index_targets = (
        ("usuarios", "idx_usuarios_empresa"),
        ("clientes", "idx_clientes_empresa"),
        ("operacoes", "idx_operacoes_empresa"),
        ("documentos", "idx_documentos_empresa"),
        ("dashboard_goals", "idx_dashboard_goals_empresa"),
        ("operation_comments", "idx_operation_comments_empresa"),
        ("operation_notifications", "idx_operation_notifications_empresa"),
        ("operation_status_history", "idx_operation_status_history_empresa"),
    )
    for table_name, index_name in index_targets:
        if table_name not in table_columns:
            continue
        cursor.execute(
            """
            SELECT 1
            FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = %s
              AND INDEX_NAME = %s
            LIMIT 1
            """,
            (table_name, index_name),
        )
        if cursor.fetchone() is not None:
            continue
        cursor.execute(
            f"CREATE INDEX {index_name} ON {table_name} (empresa_id)"
        )
        changed = True

    if changed:
        db.commit()

    return default_company_id


def fetch_company_row(cursor, company_id):
    cursor.execute(
        """
        SELECT *
        FROM empresas
        WHERE id = %s
        LIMIT 1
        """,
        (int(company_id),),
    )
    return cursor.fetchone()


def current_user_company_id():
    jwt_data = get_jwt() or {}
    raw_company_id = jwt_data.get("empresa_id")
    try:
        company_id = int(raw_company_id or 0)
    except (TypeError, ValueError):
        company_id = 0

    if company_id > 0:
        return company_id

    try:
        user_id = int(get_jwt_identity())
    except (TypeError, ValueError, RuntimeError):
        return 0

    db = get_db()
    cursor = db.cursor(dictionary=True)
    try:
        ensure_company_scope_columns(cursor, db)
        cursor.execute(
            """
            SELECT empresa_id
            FROM usuarios
            WHERE id = %s
            LIMIT 1
            """,
            (user_id,),
        )
        row = cursor.fetchone() or {}
        return int(row.get("empresa_id") or 0)
    finally:
        cursor.close()
        db.close()


def list_companies(cursor, only_active=False):
    where_clause = "WHERE ativa = 1" if only_active else ""
    cursor.execute(
        f"""
        SELECT
            id,
            nome,
            slug,
            logo_url,
            cor_primaria,
            cor_secundaria,
            ativa,
            criado_em
        FROM empresas
        {where_clause}
        ORDER BY nome ASC
        """
    )
    return cursor.fetchall()
