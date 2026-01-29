from flask import Flask
from flask_cors import CORS

def create_app():
    app = Flask(__name__)

    CORS(
        app,
        resources={r"/api/*": {"origins": "*"}},
        supports_credentials=True
    )

    app.register_blueprint(health_bp, url_prefix="/api")
    app.register_blueprint(auth_bp, url_prefix="/api")
    app.register_blueprint(clients_bp, url_prefix="/api")

    return app
