import os

from dotenv import load_dotenv
from flask import Flask
from flask_cors import CORS
from flask_jwt_extended import JWTManager

from app.routes.auth import auth_bp
from app.routes.clients import clients_bp
from app.routes.health import health_bp
from app.routes.users import users_bp

load_dotenv()


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

    app.register_blueprint(health_bp, url_prefix="/api")
    app.register_blueprint(auth_bp, url_prefix="/api")
    app.register_blueprint(clients_bp, url_prefix="/api")
    app.register_blueprint(users_bp, url_prefix="/api")

    return app


app = create_app()


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=int(os.getenv("PORT", 5000)),
        debug=os.getenv("FLASK_DEBUG", "0") == "1",
    )
