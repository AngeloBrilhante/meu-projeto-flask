from flask import Blueprint, jsonify, request
from flask_jwt_extended import create_access_token, get_jwt_identity, jwt_required
from werkzeug.security import check_password_hash

from app.database import get_db

auth_bp = Blueprint("auth", __name__)


@auth_bp.route("/login", methods=["POST"])
def login():
    data = request.get_json(silent=True)

    if not data:
        return jsonify({"message": "JSON invalido"}), 400

    email = (data.get("email") or "").strip()
    senha = data.get("senha") or ""

    if not email or not senha:
        return jsonify({"message": "Email e senha obrigatorios"}), 400

    db = get_db()
    cursor = db.cursor(dictionary=True)
    cursor.execute(
        """
        SELECT id, nome, email, senha_hash, role
        FROM usuarios
        WHERE email = %s
        LIMIT 1
        """,
        (email,),
    )
    user = cursor.fetchone()
    cursor.close()
    db.close()

    if not user:
        return jsonify({"message": "Credenciais invalidas"}), 401

    stored_hash = user.get("senha_hash") or ""
    if not stored_hash or not check_password_hash(stored_hash, senha):
        return jsonify({"message": "Credenciais invalidas"}), 401

    token = create_access_token(
        identity=str(user["id"]),
        additional_claims={
            "email": user["email"],
            "role": user["role"],
        },
    )

    return (
        jsonify(
            {
                "message": "Login realizado com sucesso",
                "token": token,
                "user": {
                    "id": user["id"],
                    "nome": user["nome"],
                    "email": user["email"],
                    "role": user["role"],
                },
            }
        ),
        200,
    )


@auth_bp.route("/me", methods=["GET"])
@jwt_required()
def me():
    return jsonify({"id": get_jwt_identity()}), 200

