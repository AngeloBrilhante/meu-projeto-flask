import os

from dotenv import load_dotenv
from flask import Flask, g, jsonify, request
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
    SESSION_MESSAGES,
    SESSION_REPLACED,
    ensure_system_settings_table,
    ensure_user_security_columns,
    get_session_rejection,
    get_maintenance_state,
    is_session_exempt,
)

load_dotenv()

MAINTENANCE_PUBLIC_PATHS = {
    "/api/health",
    "/api/login",
    "/api/users/login",
    "/api/logout",
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
    # Anexos do cliente aceitam ate 25 MB por arquivo; margem para o multipart.
    app.config["MAX_CONTENT_LENGTH"] = 30 * 1024 * 1024

    jwt = JWTManager(app)

    @jwt.token_in_blocklist_loader
    def check_single_session(jwt_header, jwt_payload):
        role = jwt_payload.get("role")
        if is_session_exempt(role):
            return False

        db = None
        cursor = None
        try:
            db = get_db()
            cursor = db.cursor(dictionary=True)
            ensure_user_security_columns(cursor, db)
            reason = get_session_rejection(
                cursor,
                int(jwt_payload.get("sub")),
                role,
                jwt_payload.get("sid"),
            )
        except Exception:
            # Falha de banco nao deve derrubar a sessao de todos os usuarios.
            app.logger.exception("Falha ao validar sessao unica")
            return False
        finally:
            if cursor is not None:
                cursor.close()
            if db is not None:
                db.close()

        if reason:
            g.session_rejection = reason
            return True
        return False

    @jwt.revoked_token_loader
    def session_rejected(jwt_header, jwt_payload):
        reason = getattr(g, "session_rejection", SESSION_REPLACED)
        return jsonify({"error": SESSION_MESSAGES[reason], "code": reason}), 401

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
