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


def can_access_client(client_id):
    """
    GLOBAL: acesso total
    ADMIN: somente clientes da propria empresa
    VENDEDOR: somente clientes vinculados a ele
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

    if is_admin():
        cursor.execute(
            "SELECT 1 FROM clientes WHERE id=%s AND empresa_id=%s",
            (client_id, company_id)
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

