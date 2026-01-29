from flask import Blueprint, request, jsonify

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")


@auth_bp.route("/login", methods=["POST"])
def login():
    data = request.get_json()

    email = data.get("email")
    password = data.get("password")

    # MOCK (depois vira banco)
    if email == "admin@consignado.com" and password == "123456":
        return jsonify({
            "message": "Login realizado com sucesso",
            "user": {
                "id": 1,
                "email": email
            }
        }), 200

    return jsonify({"message": "Credenciais inválidas"}), 401
