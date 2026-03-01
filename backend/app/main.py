import os

from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_jwt_extended import JWTManager, get_jwt, verify_jwt_in_request

from app.database import get_db
from app.routes.auth import auth_bp
from app.routes.clients import clients_bp
from app.routes.health import health_bp
from app.routes.system import system_bp
from app.routes.users import users_bp
from app.utils.security import (
    ROLE_ADMIN,
    ROLE_GLOBAL,
    ensure_system_settings_table,
    get_maintenance_state,
)

load_dotenv()

MAINTENANCE_PUBLIC_PATHS = {
    "/api/health",
    "/api/login",
    "/api/users/login",
    "/api/system/maintenance/status",
    "/api/uploads/health",
}


def parse_cors_origins():
    raw = os.getenv("CORS_ORIGINS", "http://localhost:5173").strip()
    if raw == "*":
        return "*"
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def create_app():
    app = Flask(__name__)
    app.json.ensure_ascii = False

    app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "dev-secret-key")
    app.config["JWT_SECRET_KEY"] = os.getenv(
        "JWT_SECRET_KEY",
        app.config["SECRET_KEY"],
    )
    app.config["JWT_ACCESS_TOKEN_EXPIRES"] = False

    JWTManager(app)

    cors_origins = parse_cors_origins()
    CORS(
        app,
        resources={r"/api/*": {"origins": cors_origins}},
        supports_credentials=(cors_origins != "*"),
        allow_headers=["Content-Type", "Authorization"],
        methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    )

    @app.before_request
    def maintenance_guard():
        if not request.path.startswith("/api"):
            return None

        if request.method == "OPTIONS":
            return None

        if request.path in MAINTENANCE_PUBLIC_PATHS:
            return None

        db = None
        cursor = None
        try:
            db = get_db()
            cursor = db.cursor(dictionary=True)
            ensure_system_settings_table(cursor, db)
            state = get_maintenance_state(cursor)
        except Exception:
            return None
        finally:
            if cursor is not None:
                cursor.close()
            if db is not None:
                db.close()

        if not state.get("enabled"):
            return None

        try:
            verify_jwt_in_request(optional=True)
            role = str((get_jwt() or {}).get("role") or "").strip().upper()
            if role in {ROLE_ADMIN, ROLE_GLOBAL}:
                return None
        except Exception:
            pass

        return (
            jsonify(
                {
                    "error": str(state.get("message") or "Sistema em manutencao"),
                    "maintenance": {
                        "enabled": True,
                        "message": str(state.get("message") or "Sistema em manutencao"),
                    },
                }
            ),
            503,
        )

    app.register_blueprint(health_bp, url_prefix="/api")
    app.register_blueprint(auth_bp, url_prefix="/api")
    app.register_blueprint(clients_bp, url_prefix="/api")
    app.register_blueprint(users_bp, url_prefix="/api")
    app.register_blueprint(system_bp, url_prefix="/api")

    return app


app = create_app()


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=int(os.getenv("PORT", 5000)),
        debug=os.getenv("FLASK_DEBUG", "0") == "1",
    )
