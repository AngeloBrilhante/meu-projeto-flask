from flask import Blueprint, jsonify, request
from flask_jwt_extended import create_access_token, get_jwt_identity, jwt_required
from werkzeug.security import check_password_hash

from app.database import get_db
from app.utils.company import ensure_company_scope_columns

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
    ensure_company_scope_columns(cursor, db)
    cursor.execute(
        """
        SELECT
            u.id,
            u.nome,
            u.email,
            u.senha_hash,
            u.role,
            u.empresa_id,
            e.nome AS empresa_nome,
            e.slug AS empresa_slug,
            e.logo_url AS empresa_logo_url,
            e.cor_primaria AS empresa_cor_primaria,
            e.cor_secundaria AS empresa_cor_secundaria
        FROM usuarios
        u
        LEFT JOIN empresas e ON e.id = u.empresa_id
        WHERE u.email = %s
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
            "empresa_id": user.get("empresa_id"),
            "empresa_nome": user.get("empresa_nome"),
            "empresa_slug": user.get("empresa_slug"),
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
                    "empresa_id": user.get("empresa_id"),
                    "empresa": {
                        "id": user.get("empresa_id"),
                        "nome": user.get("empresa_nome") or "",
                        "slug": user.get("empresa_slug") or "",
                        "logo_url": user.get("empresa_logo_url"),
                        "cor_primaria": user.get("empresa_cor_primaria"),
                        "cor_secundaria": user.get("empresa_cor_secundaria"),
                    },
                },
            }
        ),
        200,
    )


@auth_bp.route("/me", methods=["GET"])
@jwt_required()
def me():
    return jsonify({"id": get_jwt_identity()}), 200
