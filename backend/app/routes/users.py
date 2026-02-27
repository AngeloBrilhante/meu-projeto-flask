from flask import Blueprint, request, jsonify
from werkzeug.security import generate_password_hash, check_password_hash
from flask_jwt_extended import (
    create_access_token,
    jwt_required,
    get_jwt
)

from app.database import get_db

users_bp = Blueprint("users", __name__)

ALLOWED_USER_ROLES = (
    "ADMIN",
    "VENDEDOR",
    "DIGITADOR_PORT_REFIN",
    "DIGITADOR_NOVO_CARTAO",
)


def ensure_user_role_enum(cursor, db):
    cursor.execute(
        """
        SELECT
            DATA_TYPE,
            COLUMN_TYPE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'usuarios'
          AND COLUMN_NAME = 'role'
        LIMIT 1
        """
    )
    column = cursor.fetchone()

    if not column:
        return

    data_type = str(column.get("DATA_TYPE") or "").lower()
    if data_type != "enum":
        return

    column_type = str(column.get("COLUMN_TYPE") or "").upper()
    missing_roles = [
        role for role in ALLOWED_USER_ROLES if f"'{role}'" not in column_type
    ]
    if not missing_roles:
        return

    enum_values = ", ".join(f"'{role}'" for role in ALLOWED_USER_ROLES)
    cursor.execute(
        f"""
        ALTER TABLE usuarios
        MODIFY COLUMN role ENUM({enum_values}) NOT NULL DEFAULT 'VENDEDOR'
        """
    )
    db.commit()

# ======================================================
# 👤 CRIAR USUÁRIO (APENAS ADM)
# ======================================================
@users_bp.route("/users", methods=["POST"])
@jwt_required()
def create_user():
    claims = get_jwt()

    # 🔐 somente ADM pode criar usuários
    if (claims.get("role") or "").upper() != "ADMIN":
        return jsonify({"error": "Acesso não autorizado"}), 403

    data = request.get_json(force=True)


    if not data:
        return jsonify({"error": "JSON inválido ou ausente"}), 400

    nome = (data.get("nome") or "").strip()
    email = (data.get("email") or "").strip().lower()
    senha = data.get("senha") or ""
    role = (data.get("role") or "").strip().upper()

    if not nome or not email or not senha or not role:
        return jsonify({"error": "Dados obrigatórios faltando"}), 400

    if role not in ALLOWED_USER_ROLES:
        return jsonify({
            "error": "role invalido",
            "allowed_roles": list(ALLOWED_USER_ROLES),
        }), 400

    senha_hash = generate_password_hash(senha)

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        ensure_user_role_enum(cursor, db)

        cursor.execute(
            """
            INSERT INTO usuarios (nome, email, senha_hash, role)
            VALUES (%s, %s, %s, %s)
            """,
            (nome, email, senha_hash, role)
        )
        db.commit()

        return jsonify({
            "message": "Usuário criado com sucesso",
            "usuario": {
                "nome": nome,
                "email": email,
                "role": role
            }
        }), 201

    except Exception as e:
        db.rollback()
        return jsonify({"error": str(e)}), 400

    finally:
        cursor.close()
        db.close()


# ======================================================
# 🔐 LOGIN (GERA TOKEN)
# ======================================================
@users_bp.route("/users/login", methods=["POST"])
def login():
    data = request.get_json()

    if not data:
        return jsonify({"error": "JSON inválido ou ausente"}), 400

    email = data.get("email")
    senha = data.get("senha")

    if not email or not senha:
        return jsonify({"error": "Email e senha obrigatórios"}), 400

    db = get_db()
    cursor = db.cursor(dictionary=True)

    cursor.execute(
        """
        SELECT id, nome, email, senha_hash, role
        FROM usuarios
        WHERE email = %s
        """,
        (email,)
    )

    user = cursor.fetchone()

    cursor.close()
    db.close()

    if not user or not check_password_hash(user["senha_hash"], senha):
        return jsonify({"error": "Credenciais inválidas"}), 401

    # ✅ identity precisa ser STRING
    token = create_access_token(
        identity=str(user["id"]),
        additional_claims={
            "nome": user["nome"],
            "email": user["email"],
            "role": user["role"]
        }
    )

    return jsonify({
        "message": "Login realizado com sucesso",
        "token": token,
        "user": {
            "id": user["id"],
            "nome": user["nome"],
            "email": user["email"],
            "role": user["role"]
        }
    }), 200
