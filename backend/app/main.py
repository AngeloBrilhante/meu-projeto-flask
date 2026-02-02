from flask import Flask
from flask_cors import CORS

from app.routes.health import health_bp
from app.routes.auth import auth_bp
from app.routes.clients import clients_bp

app = Flask(__name__)

# CORS configurado corretamente
CORS(
    app,
    resources={r"/api/*": {"origins": "*"}},
    supports_credentials=True
)

# Blueprints
app.register_blueprint(health_bp, url_prefix="/api")
app.register_blueprint(auth_bp, url_prefix="/api")
app.register_blueprint(clients_bp, url_prefix="/api")

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
