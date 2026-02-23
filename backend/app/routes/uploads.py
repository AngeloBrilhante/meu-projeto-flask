from flask import Blueprint, jsonify

uploads_bp = Blueprint("uploads", __name__)

@uploads_bp.route("/uploads/health", methods=["GET"])
def upload_health():
    return jsonify({"status": "uploads ok"})
