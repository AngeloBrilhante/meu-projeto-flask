import os
import uuid
from werkzeug.utils import secure_filename

ALLOWED_EXTENSIONS = {"pdf", "png", "jpg", "jpeg"}
MAX_FILE_SIZE_MB = 5


def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def save_client_file(file, client_id, file_type):
    if not allowed_file(file.filename):
        raise ValueError("Tipo de arquivo não permitido")

    filename = secure_filename(file.filename)
    ext = filename.rsplit(".", 1)[1].lower()

    safe_name = f"{file_type}_{uuid.uuid4().hex}.{ext}"

    base_path = os.path.abspath("storage/clients")
    client_path = os.path.join(base_path, str(client_id))

    os.makedirs(client_path, exist_ok=True)

    file_path = os.path.join(client_path, safe_name)
    file.save(file_path)

    return {
        "filename": safe_name,
        "path": file_path
    }
