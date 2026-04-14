from flask_jwt_extended import get_jwt, get_jwt_identity
from app.database import get_db
from app.utils.company import current_user_company_id, ensure_company_scope_columns

ROLE_ADMIN = "ADMIN"
ROLE_GLOBAL = "GLOBAL"


def normalize_role(role):
    return str(role or "").strip().upper()


def current_user_id():
    return int(get_jwt_identity())


def current_user_role():
    return normalize_role(get_jwt().get("role"))


def is_admin():
    return current_user_role() in {ROLE_ADMIN, ROLE_GLOBAL}


def is_global():
    return current_user_role() == ROLE_GLOBAL


def current_user_digitador_full_scope():
    role = current_user_role()
    if not role.startswith("DIGITADOR"):
        return False

    jwt_data = get_jwt() or {}
    try:
        user_id = current_user_id()
    except (TypeError, ValueError, RuntimeError):
        return bool(jwt_data.get("digitador_full_scope"))

    db = get_db()
    cursor = db.cursor(dictionary=True)
    try:
        cursor.execute(
            """
            SELECT COALESCE(digitador_full_scope, 0) AS digitador_full_scope
            FROM usuarios
            WHERE id = %s
            LIMIT 1
            """,
            (user_id,),
        )
        row = cursor.fetchone() or {}
        return bool(row.get("digitador_full_scope"))
    except Exception:
        if "digitador_full_scope" in jwt_data:
            return bool(jwt_data.get("digitador_full_scope"))
        return role == "DIGITADOR_NOVO_CARTAO"
    finally:
        cursor.close()
        db.close()


def has_full_company_client_scope():
    return current_user_role().startswith("DIGITADOR") and current_user_digitador_full_scope()


def can_access_client(client_id):
    """
    GLOBAL: acesso total
    ADMIN: somente clientes da propria empresa
    VENDEDOR: somente clientes vinculados a ele
    DIGITADOR: clientes com operacoes do escopo de produto dele
    """
    if is_global():
        return True

    try:
        user_id = current_user_id()
    except (TypeError, ValueError, RuntimeError):
        return False

    if not user_id:
        return False

    company_id = current_user_company_id()
    if company_id <= 0:
        return False

    db = get_db()
    cursor = db.cursor(dictionary=True)
    ensure_company_scope_columns(cursor, db)

    role = current_user_role()

    if is_admin() or has_full_company_client_scope():
        cursor.execute(
            "SELECT 1 FROM clientes WHERE id=%s AND empresa_id=%s",
            (client_id, company_id)
        )
    elif role.startswith("DIGITADOR"):
        if role == "DIGITADOR_PORT_REFIN":
            allowed_products = (
                "PORTABILIDADE",
                "REFINANCIAMENTO",
                "PORTABILIDADE_REFIN",
            )
        elif role == "DIGITADOR_NOVO_CARTAO":
            allowed_products = (
                "NOVO",
                "FGTS",
                "CARTAO",
                "SAQUE_COMPLEMENTAR",
            )
        else:
            allowed_products = ()

        if not allowed_products:
            cursor.close()
            db.close()
            return False

        placeholders = ", ".join(["%s"] * len(allowed_products))
        cursor.execute(
            f"""
            SELECT 1
            FROM clientes c
            JOIN operacoes o ON o.cliente_id = c.id
            WHERE c.id=%s
              AND c.empresa_id=%s
              AND o.empresa_id=%s
              AND UPPER(o.produto) IN ({placeholders})
            LIMIT 1
            """,
            (client_id, company_id, company_id, *allowed_products),
        )
    else:
        cursor.execute(
            "SELECT 1 FROM clientes WHERE id=%s AND vendedor_id=%s AND empresa_id=%s",
            (client_id, user_id, company_id)
        )

    allowed = cursor.fetchone() is not None

    cursor.close()
    db.close()

    return allowed

