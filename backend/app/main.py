from flask import Flask
from flask_cors import CORS
from app.routes.health import health_bp
from app.routes.auth import auth_bp
from app.routes.clients import clients_bp


def create_app():
    app = Flask(__name__)
    CORS(
    app,
    resources={r"/*": {"origins": [
        "http://localhost:5173",
        "https://courageous-cucurucho-06cfef.netlify.app"
    ]}},
    supports_credentials=True
)



    app.register_blueprint(health_bp, url_prefix="/api")
    app.register_blueprint(auth_bp)
    app.register_blueprint(clients_bp)
    
    return app


app = create_app()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)

