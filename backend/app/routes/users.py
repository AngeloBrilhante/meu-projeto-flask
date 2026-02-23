from flask import Blueprint, request, jsonify
from werkzeug.security import generate_password_hash, check_password_hash
from flask_jwt_extended import (
    create_access_token,
    jwt_required,
    get_jwt
)

from app.database import get_db

users_bp = Blueprint("users", __name__)

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

    nome = data.get("nome")
    email = data.get("email")
    senha = data.get("senha")
    role = data.get("role")  # ADM ou VENDEDOR

    if not nome or not email or not senha or not role:
        return jsonify({"error": "Dados obrigatórios faltando"}), 400

    senha_hash = generate_password_hash(senha)

    db = get_db()
    cursor = db.cursor()

    try:
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
