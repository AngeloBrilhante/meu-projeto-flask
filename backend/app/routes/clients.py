import os
import uuid
from datetime import datetime
from flask import Blueprint, request, jsonify, send_from_directory, abort

clients_bp = Blueprint("clients", __name__)

# Pasta base onde os arquivos ficam salvos
BASE_STORAGE = os.path.join(os.getcwd(), "storage", "clients")

# Tipos de documentos permitidos
ALLOWED_EXTENSIONS = {"pdf", "jpg", "jpeg", "png"}


def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


# ======================================================
# 📤 UPLOAD DE DOCUMENTOS
# ======================================================
@clients_bp.route("/api/clients/upload", methods=["POST"])
def upload_documents():
    client_id = request.form.get("client_id")

    if not client_id:
        return jsonify({"error": "client_id é obrigatório"}), 400

    client_folder = os.path.join(BASE_STORAGE, str(client_id))
    os.makedirs(client_folder, exist_ok=True)

    saved_files = {}

    for field_name, file in request.files.items():
        if file and allowed_file(file.filename):
            ext = file.filename.rsplit(".", 1)[1].lower()
            secure_name = f"{field_name}_{uuid.uuid4().hex}.{ext}"
            file.save(os.path.join(client_folder, secure_name))
            saved_files[field_name] = secure_name

    if not saved_files:
        return jsonify({"error": "Nenhum arquivo válido enviado"}), 400

    return jsonify({
        "message": "Arquivos enviados com sucesso",
        "files": saved_files
    }), 201


# ======================================================
# 📃 LISTAGEM DE DOCUMENTOS DO CLIENTE
# ======================================================
@clients_bp.route("/api/clients/<int:client_id>/documents", methods=["GET"])
def list_documents(client_id):
    client_folder = os.path.join(BASE_STORAGE, str(client_id))

    if not os.path.exists(client_folder):
        return jsonify({
            "client_id": client_id,
            "documents": []
        }), 200

    documents = []

    for filename in os.listdir(client_folder):
        file_path = os.path.join(client_folder, filename)

        documents.append({
            "filename": filename,
            "type": filename.split("_")[0].upper(),
            "uploaded_at": datetime.fromtimestamp(
                os.path.getctime(file_path)
            ).strftime("%Y-%m-%d %H:%M:%S")
        })

    return jsonify({
        "client_id": client_id,
        "documents": documents
    }), 200


# ======================================================
# 📥 DOWNLOAD SEGURO DE DOCUMENTO
# ======================================================
@clients_bp.route(
    "/api/clients/<int:client_id>/documents/<filename>",
    methods=["GET"]
)
def download_document(client_id, filename):
    client_folder = os.path.join(BASE_STORAGE, str(client_id))

    file_path = os.path.join(client_folder, filename)

    if not os.path.exists(file_path):
        abort(404, description="Arquivo não encontrado")

    return send_from_directory(
        directory=client_folder,
        path=filename,
        as_attachment=True
    )

# ======================================================
# 🗑️ EXCLUSÃO DE DOCUMENTO
# ======================================================
@clients_bp.route(
    "/api/clients/<int:client_id>/documents/<filename>",
    methods=["DELETE"]
)
def delete_document(client_id, filename):
    client_folder = os.path.join(BASE_STORAGE, str(client_id))
    file_path = os.path.join(client_folder, filename)

    if not os.path.exists(file_path):
        return jsonify({"error": "Arquivo não encontrado"}), 404

    os.remove(file_path)

    return jsonify({
        "message": "Documento excluído com sucesso",
        "filename": filename
    }), 200
