import os
import re
import uuid

from flask import (
    Blueprint,
    abort,
    has_request_context,
    jsonify,
    request,
    send_from_directory,
)
from flask_jwt_extended import (
    create_access_token,
    get_jwt,
    get_jwt_identity,
    jwt_required,
)
from werkzeug.security import check_password_hash, generate_password_hash

from app.database import get_db

users_bp = Blueprint("users", __name__)

ALLOWED_USER_ROLES = (
    "ADMIN",
    "VENDEDOR",
    "DIGITADOR_PORT_REFIN",
    "DIGITADOR_NOVO_CARTAO",
)

EMAIL_REGEX = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
AVATAR_ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}
MAX_NAME_LENGTH = 100
MAX_EMAIL_LENGTH = 100
MAX_PHONE_LENGTH = 30
MAX_BIO_LENGTH = 255
MIN_PASSWORD_LENGTH = 6

STORAGE_ROOT = os.getenv("STORAGE_ROOT", os.path.join(os.getcwd(), "storage"))
USERS_STORAGE_ROOT = os.path.join(STORAGE_ROOT, "users")


def normalize_role(role):
    return str(role or "").strip().upper()


def normalize_email(email):
    return str(email or "").strip().lower()


def valid_email(email):
    return bool(EMAIL_REGEX.match(email or ""))


def allowed_avatar(filename):
    if "." not in filename:
        return False
    ext = filename.rsplit(".", 1)[1].lower()
    return ext in AVATAR_ALLOWED_EXTENSIONS


def build_avatar_url(user_id, avatar_filename):
    if not avatar_filename:
        return None

    path = f"/api/users/{int(user_id)}/avatar/{avatar_filename}"
    if has_request_context():
        return f"{request.url_root.rstrip('/')}{path}"
    return path


def ensure_user_role_enum(cursor, db):
    cursor.execute(
        """
        SELECT
            DATA_TYPE,
            COLUMN_TYPE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'usuarios'
          AND COLUMN_NAME = 'role'
        LIMIT 1
        """
    )
    column = cursor.fetchone()

    if not column:
        return

    data_type = str(column.get("DATA_TYPE") or "").lower()
    if data_type != "enum":
        return

    column_type = str(column.get("COLUMN_TYPE") or "").upper()
    missing_roles = [
        role for role in ALLOWED_USER_ROLES if f"'{role}'" not in column_type
    ]
    if not missing_roles:
        return

    enum_values = ", ".join(f"'{role}'" for role in ALLOWED_USER_ROLES)
    cursor.execute(
        f"""
        ALTER TABLE usuarios
        MODIFY COLUMN role ENUM({enum_values}) NOT NULL DEFAULT 'VENDEDOR'
        """
    )
    db.commit()


def ensure_user_profile_columns(cursor, db):
    cursor.execute(
        """
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'usuarios'
        """
    )
    columns = {row.get("COLUMN_NAME") for row in cursor.fetchall()}
    changed = False

    if "telefone" not in columns:
        cursor.execute("ALTER TABLE usuarios ADD COLUMN telefone VARCHAR(30) NULL")
        changed = True

    if "bio" not in columns:
        cursor.execute("ALTER TABLE usuarios ADD COLUMN bio VARCHAR(255) NULL")
        changed = True

    if "foto_arquivo" not in columns:
        cursor.execute("ALTER TABLE usuarios ADD COLUMN foto_arquivo VARCHAR(255) NULL")
        changed = True

    if changed:
        db.commit()


def serialize_user(row):
    if not row:
        return None

    user_id = int(row.get("id"))
    return {
        "id": user_id,
        "nome": row.get("nome") or "",
        "email": row.get("email") or "",
        "role": normalize_role(row.get("role")),
        "telefone": row.get("telefone") or "",
        "bio": row.get("bio") or "",
        "foto_url": build_avatar_url(user_id, row.get("foto_arquivo")),
    }


def fetch_user_row(cursor, user_id):
    cursor.execute(
        """
        SELECT
            id,
            nome,
            email,
            role,
            COALESCE(telefone, '') AS telefone,
            COALESCE(bio, '') AS bio,
            foto_arquivo,
            senha_hash
        FROM usuarios
        WHERE id = %s
        LIMIT 1
        """,
        (int(user_id),),
    )
    return cursor.fetchone()


@users_bp.route("/users", methods=["POST"])
@jwt_required()
def create_user():
    claims = get_jwt()
    if normalize_role(claims.get("role")) != "ADMIN":
        return jsonify({"error": "Acesso nao autorizado"}), 403

    data = request.get_json(silent=True) or {}
    nome = str(data.get("nome") or "").strip()
    email = normalize_email(data.get("email"))
    senha = data.get("senha") or ""
    role = normalize_role(data.get("role"))

    if not nome or not email or not senha or not role:
        return jsonify({"error": "Dados obrigatorios faltando"}), 400

    if len(nome) > MAX_NAME_LENGTH:
        return jsonify({"error": f"nome excede {MAX_NAME_LENGTH} caracteres"}), 400

    if len(email) > MAX_EMAIL_LENGTH or not valid_email(email):
        return jsonify({"error": "email invalido"}), 400

    if len(senha) < MIN_PASSWORD_LENGTH:
        return jsonify({"error": f"senha deve ter ao menos {MIN_PASSWORD_LENGTH} caracteres"}), 400

    if role not in ALLOWED_USER_ROLES:
        return jsonify(
            {
                "error": "role invalido",
                "allowed_roles": list(ALLOWED_USER_ROLES),
            }
        ), 400

    senha_hash = generate_password_hash(senha)

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        ensure_user_role_enum(cursor, db)
        ensure_user_profile_columns(cursor, db)

        cursor.execute(
            """
            INSERT INTO usuarios (nome, email, senha_hash, role)
            VALUES (%s, %s, %s, %s)
            """,
            (nome, email, senha_hash, role),
        )
        db.commit()

        created_id = cursor.lastrowid
        row = fetch_user_row(cursor, created_id)

        return (
            jsonify(
                {
                    "message": "Usuario criado com sucesso",
                    "user": serialize_user(row),
                }
            ),
            201,
        )
    except Exception as exc:
        db.rollback()
        message = str(exc)
        if "Duplicate entry" in message and "email" in message:
            return jsonify({"error": "Email ja cadastrado"}), 409
        return jsonify({"error": "Nao foi possivel criar o usuario"}), 400
    finally:
        cursor.close()
        db.close()


@users_bp.route("/users/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    email = normalize_email(data.get("email"))
    senha = data.get("senha") or ""

    if not email or not senha:
        return jsonify({"error": "Email e senha obrigatorios"}), 400

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        ensure_user_role_enum(cursor, db)
        ensure_user_profile_columns(cursor, db)

        cursor.execute(
            """
            SELECT
                id,
                nome,
                email,
                senha_hash,
                role,
                COALESCE(telefone, '') AS telefone,
                COALESCE(bio, '') AS bio,
                foto_arquivo
            FROM usuarios
            WHERE email = %s
            LIMIT 1
            """,
            (email,),
        )
        user = cursor.fetchone()
    finally:
        cursor.close()
        db.close()

    if not user:
        return jsonify({"error": "Credenciais invalidas"}), 401

    if not check_password_hash(user.get("senha_hash") or "", senha):
        return jsonify({"error": "Credenciais invalidas"}), 401

    token = create_access_token(
        identity=str(user["id"]),
        additional_claims={
            "nome": user.get("nome"),
            "email": user.get("email"),
            "role": normalize_role(user.get("role")),
        },
    )

    return (
        jsonify(
            {
                "message": "Login realizado com sucesso",
                "token": token,
                "user": serialize_user(user),
            }
        ),
        200,
    )


@users_bp.route("/users/me", methods=["GET"])
@jwt_required()
def get_current_user_profile():
    user_id = int(get_jwt_identity())

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        ensure_user_profile_columns(cursor, db)
        row = fetch_user_row(cursor, user_id)

        if not row:
            return jsonify({"error": "Usuario nao encontrado"}), 404

        return jsonify({"user": serialize_user(row)}), 200
    finally:
        cursor.close()
        db.close()


@users_bp.route("/users/me", methods=["PUT"])
@jwt_required()
def update_current_user_profile():
    user_id = int(get_jwt_identity())
    data = request.get_json(silent=True) or {}

    if not data:
        return jsonify({"error": "Nenhum dado para atualizar"}), 400

    updates = []
    params = []

    if "nome" in data:
        nome = str(data.get("nome") or "").strip()
        if len(nome) < 2:
            return jsonify({"error": "nome invalido"}), 400
        if len(nome) > MAX_NAME_LENGTH:
            return jsonify({"error": f"nome excede {MAX_NAME_LENGTH} caracteres"}), 400
        updates.append("nome = %s")
        params.append(nome)

    if "email" in data:
        email = normalize_email(data.get("email"))
        if not valid_email(email) or len(email) > MAX_EMAIL_LENGTH:
            return jsonify({"error": "email invalido"}), 400
        updates.append("email = %s")
        params.append(email)

    if "telefone" in data:
        telefone = str(data.get("telefone") or "").strip()
        if len(telefone) > MAX_PHONE_LENGTH:
            return jsonify({"error": f"telefone excede {MAX_PHONE_LENGTH} caracteres"}), 400
        updates.append("telefone = %s")
        params.append(telefone or None)

    if "bio" in data:
        bio = str(data.get("bio") or "").strip()
        if len(bio) > MAX_BIO_LENGTH:
            return jsonify({"error": f"bio excede {MAX_BIO_LENGTH} caracteres"}), 400
        updates.append("bio = %s")
        params.append(bio or None)

    if not updates:
        return jsonify({"error": "Nenhum campo valido para atualizacao"}), 400

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        ensure_user_profile_columns(cursor, db)

        if "email" in data:
            normalized_email = normalize_email(data.get("email"))
            cursor.execute(
                """
                SELECT id
                FROM usuarios
                WHERE email = %s
                  AND id <> %s
                LIMIT 1
                """,
                (normalized_email, user_id),
            )
            email_in_use = cursor.fetchone()
            if email_in_use:
                return jsonify({"error": "Email ja esta em uso"}), 409

        params.append(user_id)
        cursor.execute(
            f"""
            UPDATE usuarios
            SET {", ".join(updates)}
            WHERE id = %s
            """,
            tuple(params),
        )
        db.commit()

        row = fetch_user_row(cursor, user_id)
        return jsonify({"message": "Perfil atualizado com sucesso", "user": serialize_user(row)}), 200
    finally:
        cursor.close()
        db.close()


@users_bp.route("/users/me/password", methods=["PUT"])
@jwt_required()
def update_current_user_password():
    user_id = int(get_jwt_identity())
    data = request.get_json(silent=True) or {}

    current_password = data.get("senha_atual") or ""
    new_password = data.get("nova_senha") or ""
    confirm_password = data.get("confirmacao_nova_senha") or ""

    if not current_password or not new_password or not confirm_password:
        return jsonify({"error": "senha_atual, nova_senha e confirmacao_nova_senha sao obrigatorios"}), 400

    if len(new_password) < MIN_PASSWORD_LENGTH:
        return jsonify({"error": f"nova_senha deve ter ao menos {MIN_PASSWORD_LENGTH} caracteres"}), 400

    if new_password != confirm_password:
        return jsonify({"error": "confirmacao_nova_senha nao confere"}), 400

    if current_password == new_password:
        return jsonify({"error": "A nova senha deve ser diferente da senha atual"}), 400

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        cursor.execute(
            """
            SELECT id, senha_hash
            FROM usuarios
            WHERE id = %s
            LIMIT 1
            """,
            (user_id,),
        )
        row = cursor.fetchone()
        if not row:
            return jsonify({"error": "Usuario nao encontrado"}), 404

        if not check_password_hash(row.get("senha_hash") or "", current_password):
            return jsonify({"error": "senha_atual invalida"}), 400

        cursor.execute(
            """
            UPDATE usuarios
            SET senha_hash = %s
            WHERE id = %s
            """,
            (generate_password_hash(new_password), user_id),
        )
        db.commit()

        return jsonify({"message": "Senha atualizada com sucesso"}), 200
    finally:
        cursor.close()
        db.close()


@users_bp.route("/users/me/avatar", methods=["POST"])
@jwt_required()
def upload_current_user_avatar():
    user_id = int(get_jwt_identity())
    avatar = request.files.get("avatar")

    if not avatar or not avatar.filename:
        return jsonify({"error": "Arquivo avatar e obrigatorio"}), 400

    if not allowed_avatar(avatar.filename):
        return jsonify({"error": "Formato de avatar invalido. Use jpg, jpeg, png ou webp"}), 400

    ext = avatar.filename.rsplit(".", 1)[1].lower()
    avatar_filename = f"avatar_{uuid.uuid4().hex}.{ext}"
    user_folder = os.path.join(USERS_STORAGE_ROOT, str(user_id))
    os.makedirs(user_folder, exist_ok=True)
    avatar_path = os.path.join(user_folder, avatar_filename)

    db = get_db()
    cursor = db.cursor(dictionary=True)

    previous_avatar = None
    saved_file = False

    try:
        ensure_user_profile_columns(cursor, db)
        row = fetch_user_row(cursor, user_id)
        if not row:
            return jsonify({"error": "Usuario nao encontrado"}), 404

        previous_avatar = row.get("foto_arquivo")
        avatar.save(avatar_path)
        saved_file = True

        cursor.execute(
            """
            UPDATE usuarios
            SET foto_arquivo = %s
            WHERE id = %s
            """,
            (avatar_filename, user_id),
        )
        db.commit()

        if previous_avatar and previous_avatar != avatar_filename:
            old_path = os.path.join(user_folder, previous_avatar)
            if os.path.exists(old_path):
                os.remove(old_path)

        updated = fetch_user_row(cursor, user_id)
        return jsonify({"message": "Foto atualizada com sucesso", "user": serialize_user(updated)}), 200
    except Exception:
        db.rollback()
        if saved_file and os.path.exists(avatar_path):
            os.remove(avatar_path)
        raise
    finally:
        cursor.close()
        db.close()


@users_bp.route("/users/me/avatar", methods=["DELETE"])
@jwt_required()
def delete_current_user_avatar():
    user_id = int(get_jwt_identity())
    user_folder = os.path.join(USERS_STORAGE_ROOT, str(user_id))

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        ensure_user_profile_columns(cursor, db)
        row = fetch_user_row(cursor, user_id)
        if not row:
            return jsonify({"error": "Usuario nao encontrado"}), 404

        previous_avatar = row.get("foto_arquivo")

        if previous_avatar:
            cursor.execute(
                """
                UPDATE usuarios
                SET foto_arquivo = NULL
                WHERE id = %s
                """,
                (user_id,),
            )
            db.commit()

            old_path = os.path.join(user_folder, previous_avatar)
            if os.path.exists(old_path):
                os.remove(old_path)

        updated = fetch_user_row(cursor, user_id)
        return jsonify({"message": "Foto removida com sucesso", "user": serialize_user(updated)}), 200
    finally:
        cursor.close()
        db.close()


@users_bp.route("/users/<int:user_id>/avatar/<filename>", methods=["GET"])
def serve_user_avatar(user_id, filename):
    safe_filename = os.path.basename(filename)
    if not safe_filename or safe_filename != filename:
        abort(404, description="Arquivo nao encontrado")

    user_folder = os.path.join(USERS_STORAGE_ROOT, str(int(user_id)))
    file_path = os.path.join(user_folder, safe_filename)

    if not os.path.exists(file_path):
        abort(404, description="Arquivo nao encontrado")

    return send_from_directory(user_folder, safe_filename, as_attachment=False)
