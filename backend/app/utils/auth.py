from flask_jwt_extended import get_jwt, get_jwt_identity
from app.database import get_db


def current_user_id():
    return int(get_jwt_identity())


def current_user_role():
    return get_jwt().get("role")


def is_admin():
    return current_user_role() == "ADMIN"


def can_access_client(client_id):
    """
    ADM: acesso total
    VENDEDOR: somente clientes vinculados a ele
    """
    if is_admin():
        return True

    user_id = current_user_id()

    db = get_db()
    cursor = db.cursor(dictionary=True)

    cursor.execute(
        "SELECT 1 FROM clientes WHERE id=%s AND vendedor_id=%s",
        (client_id, user_id)
    )

    allowed = cursor.fetchone() is not None

    cursor.close()
    db.close()

    return allowed

