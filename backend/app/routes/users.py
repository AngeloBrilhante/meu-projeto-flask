import os
import re
import uuid

from flask import (
    Blueprint,
    Response,
    abort,
    current_app,
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
from app.utils.company import (
    column_exists,
    current_user_company_id,
    ensure_company_scope_columns,
    fetch_company_row,
    list_companies,
    normalize_company_slug,
    table_exists,
)
from app.utils.security import (
    add_to_trash,
    build_otpauth_uri,
    ensure_audit_logs_table,
    ensure_trash_bin_table,
    ensure_user_security_columns,
    generate_totp_secret,
    get_twofa_code_from_request,
    insert_row,
    log_audit,
    row_to_insert_dict,
    verify_totp_code,
    verify_user_twofa,
)

users_bp = Blueprint("users", __name__)

ROLE_ADMIN = "ADMIN"
ROLE_GLOBAL = "GLOBAL"

ALLOWED_USER_ROLES = (
    ROLE_ADMIN,
    ROLE_GLOBAL,
    "VENDEDOR",
    "DIGITADOR_PORT_REFIN",
    "DIGITADOR_NOVO_CARTAO",
)

EMAIL_REGEX = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
AVATAR_ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}
AVATAR_MIME_BY_EXT = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
}
MAX_NAME_LENGTH = 100
MAX_EMAIL_LENGTH = 100
MAX_PHONE_LENGTH = 30
MAX_BIO_LENGTH = 255
MIN_PASSWORD_LENGTH = 6
MAX_AVATAR_BYTES = 5 * 1024 * 1024

STORAGE_ROOT = os.getenv("STORAGE_ROOT", os.path.join(os.getcwd(), "storage"))
USERS_STORAGE_ROOT = os.path.join(STORAGE_ROOT, "users")


def normalize_role(role):
    return str(role or "").strip().upper()


def current_actor_role():
    return normalize_role((get_jwt() or {}).get("role"))


def actor_can_manage_users():
    return current_actor_role() in {ROLE_ADMIN, ROLE_GLOBAL}


def actor_is_global():
    return current_actor_role() == ROLE_GLOBAL


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

    if "foto_blob" not in columns:
        cursor.execute("ALTER TABLE usuarios ADD COLUMN foto_blob LONGBLOB NULL")
        changed = True

    if "foto_mime" not in columns:
        cursor.execute("ALTER TABLE usuarios ADD COLUMN foto_mime VARCHAR(100) NULL")
        changed = True

    if changed:
        db.commit()

    ensure_user_security_columns(cursor, db)


def serialize_user(row):
    if not row:
        return None

    user_id = int(row.get("id"))
    company_id = int(row.get("empresa_id") or 0)
    return {
        "id": user_id,
        "nome": row.get("nome") or "",
        "email": row.get("email") or "",
        "role": normalize_role(row.get("role")),
        "telefone": row.get("telefone") or "",
        "bio": row.get("bio") or "",
        "foto_url": build_avatar_url(user_id, row.get("foto_arquivo")),
        "twofa_enabled": bool(row.get("twofa_enabled")),
        "empresa_id": company_id or None,
        "empresa": {
            "id": company_id or None,
            "nome": row.get("empresa_nome") or "",
            "slug": row.get("empresa_slug") or "",
            "logo_url": row.get("empresa_logo_url"),
            "cor_primaria": row.get("empresa_cor_primaria"),
            "cor_secundaria": row.get("empresa_cor_secundaria"),
        },
    }


def fetch_user_by_email(cursor, email):
    has_user_company = column_exists(cursor, "usuarios", "empresa_id")
    has_empresas = table_exists(cursor, "empresas")
    has_telefone = column_exists(cursor, "usuarios", "telefone")
    has_bio = column_exists(cursor, "usuarios", "bio")
    has_foto_arquivo = column_exists(cursor, "usuarios", "foto_arquivo")
    has_twofa_enabled = column_exists(cursor, "usuarios", "twofa_enabled")

    cursor.execute(
        f"""
        SELECT
            u.id,
            u.nome,
            u.email,
            u.senha_hash,
            u.role,
            {("COALESCE(u.telefone, '')" if has_telefone else "''")} AS telefone,
            {("COALESCE(u.bio, '')" if has_bio else "''")} AS bio,
            {("u.foto_arquivo" if has_foto_arquivo else "NULL")} AS foto_arquivo,
            {("COALESCE(u.twofa_enabled, 0)" if has_twofa_enabled else "0")} AS twofa_enabled,
            {("u.empresa_id" if has_user_company else "NULL")} AS empresa_id,
            {("e.nome" if has_user_company and has_empresas else "NULL")} AS empresa_nome,
            {("e.slug" if has_user_company and has_empresas else "NULL")} AS empresa_slug,
            {("e.logo_url" if has_user_company and has_empresas else "NULL")} AS empresa_logo_url,
            {("e.cor_primaria" if has_user_company and has_empresas else "NULL")} AS empresa_cor_primaria,
            {("e.cor_secundaria" if has_user_company and has_empresas else "NULL")} AS empresa_cor_secundaria
        FROM usuarios u
        {("LEFT JOIN empresas e ON e.id = u.empresa_id" if has_user_company and has_empresas else "")}
        WHERE u.email = %s
        LIMIT 1
        """,
        (email,),
    )
    return cursor.fetchone()


def fetch_user_row(cursor, user_id):
    has_user_company = column_exists(cursor, "usuarios", "empresa_id")
    has_empresas = table_exists(cursor, "empresas")
    has_telefone = column_exists(cursor, "usuarios", "telefone")
    has_bio = column_exists(cursor, "usuarios", "bio")
    has_foto_arquivo = column_exists(cursor, "usuarios", "foto_arquivo")
    has_twofa_enabled = column_exists(cursor, "usuarios", "twofa_enabled")
    has_twofa_secret = column_exists(cursor, "usuarios", "twofa_secret")

    cursor.execute(
        f"""
        SELECT
            u.id,
            u.nome,
            u.email,
            u.role,
            {("COALESCE(u.telefone, '')" if has_telefone else "''")} AS telefone,
            {("COALESCE(u.bio, '')" if has_bio else "''")} AS bio,
            {("u.foto_arquivo" if has_foto_arquivo else "NULL")} AS foto_arquivo,
            u.senha_hash,
            {("u.twofa_secret" if has_twofa_secret else "NULL")} AS twofa_secret,
            {("COALESCE(u.twofa_enabled, 0)" if has_twofa_enabled else "0")} AS twofa_enabled,
            {("u.empresa_id" if has_user_company else "NULL")} AS empresa_id,
            {("e.nome" if has_user_company and has_empresas else "NULL")} AS empresa_nome,
            {("e.slug" if has_user_company and has_empresas else "NULL")} AS empresa_slug,
            {("e.logo_url" if has_user_company and has_empresas else "NULL")} AS empresa_logo_url,
            {("e.cor_primaria" if has_user_company and has_empresas else "NULL")} AS empresa_cor_primaria,
            {("e.cor_secundaria" if has_user_company and has_empresas else "NULL")} AS empresa_cor_secundaria
        FROM usuarios u
        {("LEFT JOIN empresas e ON e.id = u.empresa_id" if has_user_company and has_empresas else "")}
        WHERE u.id = %s
        LIMIT 1
        """,
        (int(user_id),),
    )
    return cursor.fetchone()


def fetch_basic_user_row(cursor, user_id):
    cursor.execute(
        """
        SELECT
            id,
            nome,
            email,
            role,
            '' AS telefone,
            '' AS bio,
            NULL AS foto_arquivo,
            0 AS twofa_enabled,
            NULL AS empresa_id,
            NULL AS empresa_nome,
            NULL AS empresa_slug,
            NULL AS empresa_logo_url,
            NULL AS empresa_cor_primaria,
            NULL AS empresa_cor_secundaria
        FROM usuarios
        WHERE id = %s
        LIMIT 1
        """,
        (int(user_id),),
    )
    return cursor.fetchone()


def require_global_twofa(cursor, actor_id):
    code = get_twofa_code_from_request()
    valid, error_message = verify_user_twofa(cursor, actor_id, code)
    if valid:
        return None
    return jsonify({"error": error_message}), 403


@users_bp.route("/users", methods=["GET"])
@jwt_required()
def list_users():
    if not actor_is_global():
        return jsonify({"error": "Somente GLOBAL pode listar todos os usuarios"}), 403

    role_filter = normalize_role(request.args.get("role"))
    company_id_raw = request.args.get("empresa_id")
    search = str(request.args.get("q") or "").strip()

    if role_filter and role_filter not in ALLOWED_USER_ROLES:
        return jsonify({"error": "role invalido"}), 400

    company_id = None
    if company_id_raw not in (None, "", "0", 0):
        try:
            company_id = int(company_id_raw)
        except (TypeError, ValueError):
            return jsonify({"error": "empresa_id invalido"}), 400

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        ensure_user_profile_columns(cursor, db)

        conditions = ["1=1"]
        params = []

        if role_filter:
            conditions.append("UPPER(u.role) = %s")
            params.append(role_filter)

        if company_id:
            conditions.append("u.empresa_id = %s")
            params.append(company_id)

        if search:
            like_term = f"%{search}%"
            conditions.append(
                """
                (
                    u.nome LIKE %s
                    OR u.email LIKE %s
                    OR COALESCE(e.nome, '') LIKE %s
                )
                """
            )
            params.extend([like_term, like_term, like_term])

        where_clause = " AND ".join(conditions)
        cursor.execute(
            f"""
            SELECT
                u.id,
                u.nome,
                u.email,
                u.role,
                COALESCE(u.telefone, '') AS telefone,
                COALESCE(u.bio, '') AS bio,
                u.foto_arquivo,
                COALESCE(u.twofa_enabled, 0) AS twofa_enabled,
                u.empresa_id,
                e.nome AS empresa_nome,
                e.slug AS empresa_slug,
                e.logo_url AS empresa_logo_url,
                e.cor_primaria AS empresa_cor_primaria,
                e.cor_secundaria AS empresa_cor_secundaria
            FROM usuarios u
            LEFT JOIN empresas e ON e.id = u.empresa_id
            WHERE {where_clause}
            ORDER BY e.nome ASC, u.nome ASC, u.id ASC
            """,
            tuple(params),
        )
        rows = cursor.fetchall() or []
        return jsonify({"users": [serialize_user(row) for row in rows], "total": len(rows)}), 200
    finally:
        cursor.close()
        db.close()


@users_bp.route("/users", methods=["POST"])
@jwt_required()
def create_user():
    if not actor_can_manage_users():
        return jsonify({"error": "Acesso nao autorizado"}), 403

    data = request.get_json(silent=True) or {}
    nome = str(data.get("nome") or "").strip()
    email = normalize_email(data.get("email"))
    senha = data.get("senha") or ""
    role = normalize_role(data.get("role"))
    raw_empresa_id = data.get("empresa_id")

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
        actor_role = current_actor_role()
        actor_company_id = current_user_company_id()

        if actor_role == ROLE_GLOBAL:
            if raw_empresa_id in (None, "", 0, "0"):
                return jsonify({"error": "empresa_id e obrigatorio para GLOBAL"}), 400
            try:
                empresa_id = int(raw_empresa_id)
            except (TypeError, ValueError):
                return jsonify({"error": "empresa_id invalido"}), 400
        else:
            empresa_id = actor_company_id

        company = fetch_company_row(cursor, empresa_id)
        if not company:
            return jsonify({"error": "Empresa nao encontrada"}), 404

        cursor.execute(
            """
            INSERT INTO usuarios (nome, email, senha_hash, role, empresa_id)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (nome, email, senha_hash, role, empresa_id),
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
        user = fetch_user_by_email(cursor, email)
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
            "empresa_id": user.get("empresa_id"),
            "empresa_nome": user.get("empresa_nome"),
            "empresa_slug": user.get("empresa_slug"),
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
        try:
            ensure_user_profile_columns(cursor, db)
            row = fetch_user_row(cursor, user_id)
        except Exception as exc:
            db.rollback()
            current_app.logger.warning(
                "Fallback ao carregar /api/users/me para usuario %s: %s",
                user_id,
                exc,
            )
            row = fetch_basic_user_row(cursor, user_id)

        if not row:
            return jsonify({"error": "Usuario nao encontrado"}), 404

        return jsonify({"user": serialize_user(row)}), 200
    finally:
        cursor.close()
        db.close()


@users_bp.route("/companies", methods=["GET"])
@jwt_required()
def get_companies():
    db = get_db()
    cursor = db.cursor(dictionary=True)
    try:
        ensure_company_scope_columns(cursor, db)
        if actor_is_global():
            companies = list_companies(cursor)
        else:
            company = fetch_company_row(cursor, current_user_company_id())
            companies = [company] if company else []
        return jsonify({"companies": companies}), 200
    finally:
        cursor.close()
        db.close()


@users_bp.route("/companies", methods=["POST"])
@jwt_required()
def create_company():
    if not actor_is_global():
        return jsonify({"error": "Somente GLOBAL pode criar empresas"}), 403

    data = request.get_json(silent=True) or {}
    nome = str(data.get("nome") or "").strip()
    slug = normalize_company_slug(data.get("slug") or nome)

    if not nome:
        return jsonify({"error": "nome e obrigatorio"}), 400
    if not slug:
        return jsonify({"error": "slug invalido"}), 400

    logo_url = str(data.get("logo_url") or "").strip() or None
    cor_primaria = str(data.get("cor_primaria") or "").strip() or None
    cor_secundaria = str(data.get("cor_secundaria") or "").strip() or None

    db = get_db()
    cursor = db.cursor(dictionary=True)
    try:
        ensure_company_scope_columns(cursor, db)
        cursor.execute(
            """
            INSERT INTO empresas (
                nome,
                slug,
                logo_url,
                cor_primaria,
                cor_secundaria,
                ativa
            )
            VALUES (%s, %s, %s, %s, %s, 1)
            """,
            (nome, slug, logo_url, cor_primaria, cor_secundaria),
        )
        db.commit()
        company = fetch_company_row(cursor, cursor.lastrowid)
        return jsonify({"message": "Empresa criada com sucesso", "company": company}), 201
    except Exception as exc:
        db.rollback()
        if "Duplicate entry" in str(exc) and "uq_empresas_slug" in str(exc):
            return jsonify({"error": "Slug ja cadastrado"}), 409
        return jsonify({"error": "Nao foi possivel criar a empresa"}), 400
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


@users_bp.route("/users/me/2fa/status", methods=["GET"])
@jwt_required()
def get_twofa_status():
    user_id = int(get_jwt_identity())

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        ensure_user_profile_columns(cursor, db)
        row = fetch_user_row(cursor, user_id)
        if not row:
            return jsonify({"error": "Usuario nao encontrado"}), 404

        return jsonify({"twofa_enabled": bool(row.get("twofa_enabled"))}), 200
    finally:
        cursor.close()
        db.close()


@users_bp.route("/users/me/2fa/setup", methods=["POST"])
@jwt_required()
def setup_twofa():
    user_id = int(get_jwt_identity())
    data = request.get_json(silent=True) or {}
    issuer = str(data.get("issuer") or "Aureon Capital").strip() or "Aureon Capital"

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        ensure_user_profile_columns(cursor, db)
        row = fetch_user_row(cursor, user_id)
        if not row:
            return jsonify({"error": "Usuario nao encontrado"}), 404

        secret = str(row.get("twofa_secret") or "").strip() or generate_totp_secret()
        cursor.execute(
            """
            UPDATE usuarios
            SET twofa_secret = %s,
                twofa_enabled = 0
            WHERE id = %s
            """,
            (secret, user_id),
        )
        db.commit()

        return jsonify(
            {
                "message": "2FA preparado. Confirme com um codigo para ativar.",
                "secret": secret,
                "otpauth_url": build_otpauth_uri(secret, row.get("email"), issuer=issuer),
                "issuer": issuer,
                "account": row.get("email") or "",
            }
        ), 200
    finally:
        cursor.close()
        db.close()


@users_bp.route("/users/me/2fa/enable", methods=["POST"])
@jwt_required()
def enable_twofa():
    user_id = int(get_jwt_identity())
    data = request.get_json(silent=True) or {}
    code = str(data.get("code") or "").strip()

    if not code:
        return jsonify({"error": "code obrigatorio"}), 400

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        ensure_user_profile_columns(cursor, db)
        row = fetch_user_row(cursor, user_id)
        if not row:
            return jsonify({"error": "Usuario nao encontrado"}), 404

        secret = str(row.get("twofa_secret") or "").strip()
        if not secret:
            return jsonify({"error": "2FA nao configurado. Execute /users/me/2fa/setup primeiro"}), 400

        if not verify_totp_code(secret, code):
            return jsonify({"error": "Codigo 2FA invalido"}), 400

        cursor.execute(
            """
            UPDATE usuarios
            SET twofa_enabled = 1
            WHERE id = %s
            """,
            (user_id,),
        )
        db.commit()

        return jsonify({"message": "2FA ativado com sucesso", "twofa_enabled": True}), 200
    finally:
        cursor.close()
        db.close()


@users_bp.route("/users/me/2fa/disable", methods=["POST"])
@jwt_required()
def disable_twofa():
    user_id = int(get_jwt_identity())
    data = request.get_json(silent=True) or {}

    current_password = data.get("senha_atual") or ""
    code = str(data.get("code") or "").strip()

    if not current_password or not code:
        return jsonify({"error": "senha_atual e code sao obrigatorios"}), 400

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        ensure_user_profile_columns(cursor, db)
        row = fetch_user_row(cursor, user_id)
        if not row:
            return jsonify({"error": "Usuario nao encontrado"}), 404

        if not check_password_hash(row.get("senha_hash") or "", current_password):
            return jsonify({"error": "senha_atual invalida"}), 400

        secret = str(row.get("twofa_secret") or "").strip()
        if not secret or not bool(row.get("twofa_enabled")):
            return jsonify({"error": "2FA nao esta ativo"}), 400

        if not verify_totp_code(secret, code):
            return jsonify({"error": "Codigo 2FA invalido"}), 400

        cursor.execute(
            """
            UPDATE usuarios
            SET twofa_enabled = 0
            WHERE id = %s
            """,
            (user_id,),
        )
        db.commit()

        return jsonify({"message": "2FA desativado com sucesso", "twofa_enabled": False}), 200
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
    avatar_mime = AVATAR_MIME_BY_EXT.get(ext, "application/octet-stream")
    avatar_filename = f"avatar_{uuid.uuid4().hex}.{ext}"
    avatar_bytes = avatar.read()

    if not avatar_bytes:
        return jsonify({"error": "Arquivo de avatar vazio"}), 400

    if len(avatar_bytes) > MAX_AVATAR_BYTES:
        max_mb = int(MAX_AVATAR_BYTES / (1024 * 1024))
        return jsonify({"error": f"Arquivo muito grande. Limite de {max_mb}MB"}), 400

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        ensure_user_profile_columns(cursor, db)
        row = fetch_user_row(cursor, user_id)
        if not row:
            return jsonify({"error": "Usuario nao encontrado"}), 404

        previous_avatar = row.get("foto_arquivo")

        # Tenta manter copia local para compatibilidade, mas a fonte de verdade e o banco.
        user_folder = os.path.join(USERS_STORAGE_ROOT, str(user_id))
        os.makedirs(user_folder, exist_ok=True)
        avatar_path = os.path.join(user_folder, avatar_filename)
        try:
            with open(avatar_path, "wb") as avatar_file:
                avatar_file.write(avatar_bytes)
        except Exception:
            pass

        cursor.execute(
            """
            UPDATE usuarios
            SET foto_arquivo = %s,
                foto_blob = %s,
                foto_mime = %s
            WHERE id = %s
            """,
            (avatar_filename, avatar_bytes, avatar_mime, user_id),
        )
        db.commit()

        if previous_avatar and previous_avatar != avatar_filename:
            old_path = os.path.join(user_folder, previous_avatar)
            if os.path.exists(old_path):
                os.remove(old_path)

        updated = fetch_user_row(cursor, user_id)
        return jsonify({"message": "Foto atualizada com sucesso", "user": serialize_user(updated)}), 200
    except Exception as exc:
        db.rollback()
        return jsonify({"error": f"Nao foi possivel atualizar a foto: {str(exc)}"}), 400
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
                  ,foto_blob = NULL
                  ,foto_mime = NULL
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


@users_bp.route("/users/<int:user_id>", methods=["DELETE"])
@jwt_required()
def delete_user(user_id):
    actor_id = int(get_jwt_identity())
    actor_role = current_actor_role()

    if not actor_is_global():
        return jsonify({"error": "Somente GLOBAL pode excluir usuarios"}), 403

    if user_id == actor_id:
        return jsonify({"error": "Usuario GLOBAL nao pode excluir a propria conta"}), 400

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        ensure_user_profile_columns(cursor, db)
        ensure_trash_bin_table(cursor, db)
        ensure_audit_logs_table(cursor, db)

        twofa_error = require_global_twofa(cursor, actor_id)
        if twofa_error:
            log_audit(
                cursor,
                actor_id=actor_id,
                actor_role=actor_role,
                action="DELETE_USER",
                target_type="USUARIO",
                target_id=user_id,
                success=False,
                reason="2FA invalido",
            )
            db.commit()
            return twofa_error

        cursor.execute(
            """
            SELECT *
            FROM usuarios
            WHERE id = %s
            LIMIT 1
            """,
            (user_id,),
        )
        target = cursor.fetchone()
        if not target:
            return jsonify({"error": "Usuario nao encontrado"}), 404

        target_role = normalize_role(target.get("role"))
        if target_role == ROLE_GLOBAL:
            cursor.execute(
                """
                SELECT COUNT(*) AS total_globals
                FROM usuarios
                WHERE UPPER(role) = %s
                """,
                (ROLE_GLOBAL,),
            )
            total_globals = int((cursor.fetchone() or {}).get("total_globals") or 0)
            if total_globals <= 1:
                log_audit(
                    cursor,
                    actor_id=actor_id,
                    actor_role=actor_role,
                    action="DELETE_USER",
                    target_type="USUARIO",
                    target_id=user_id,
                    success=False,
                    reason="Tentativa de remover ultimo GLOBAL",
                )
                db.commit()
                return jsonify({"error": "Nao e permitido remover o ultimo usuario GLOBAL"}), 409

        cursor.execute(
            """
            SELECT COUNT(*) AS clients_count
            FROM clientes
            WHERE vendedor_id = %s
            """,
            (user_id,),
        )
        clients_count = int((cursor.fetchone() or {}).get("clients_count") or 0)
        if clients_count > 0:
            log_audit(
                cursor,
                actor_id=actor_id,
                actor_role=actor_role,
                action="DELETE_USER",
                target_type="USUARIO",
                target_id=user_id,
                success=False,
                reason="Usuario com clientes vinculados",
                metadata={"clients_count": clients_count},
            )
            db.commit()
            return jsonify(
                {
                    "error": "Usuario possui clientes vinculados. Exclua/realoque os clientes antes de remover o usuario.",
                    "clients_count": clients_count,
                }
            ), 409

        trash_id = add_to_trash(
            cursor,
            entity_type="USUARIO",
            entity_id=user_id,
            payload={"user": row_to_insert_dict(target)},
            deleted_by=actor_id,
            deleted_role=actor_role,
            reason="Exclusao individual de usuario",
        )

        cursor.execute(
            """
            DELETE FROM usuarios
            WHERE id = %s
            """,
            (user_id,),
        )
        log_audit(
            cursor,
            actor_id=actor_id,
            actor_role=actor_role,
            action="DELETE_USER",
            target_type="USUARIO",
            target_id=user_id,
            success=True,
            metadata={"trash_id": trash_id},
        )
        db.commit()

        return jsonify(
            {
                "message": "Usuario excluido com sucesso",
                "user": {
                    "id": int(target.get("id")),
                    "nome": target.get("nome") or "",
                    "email": target.get("email") or "",
                    "role": target_role,
                },
                "trash_id": int(trash_id),
            }
        ), 200
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

    if os.path.exists(file_path):
        return send_from_directory(user_folder, safe_filename, as_attachment=False)

    db = get_db()
    cursor = db.cursor(dictionary=True)
    try:
        ensure_user_profile_columns(cursor, db)
        cursor.execute(
            """
            SELECT foto_arquivo, foto_blob, foto_mime
            FROM usuarios
            WHERE id = %s
            LIMIT 1
            """,
            (int(user_id),),
        )
        row = cursor.fetchone()
    finally:
        cursor.close()
        db.close()

    if not row:
        abort(404, description="Arquivo nao encontrado")

    current_filename = os.path.basename(str(row.get("foto_arquivo") or ""))
    if current_filename and current_filename != safe_filename:
        abort(404, description="Arquivo nao encontrado")

    avatar_blob = row.get("foto_blob")
    if not avatar_blob:
        abort(404, description="Arquivo nao encontrado")

    if isinstance(avatar_blob, memoryview):
        avatar_blob = avatar_blob.tobytes()

    mime_type = str(row.get("foto_mime") or "").strip() or "application/octet-stream"
    response = Response(avatar_blob, mimetype=mime_type)
    response.headers["Cache-Control"] = "public, max-age=60"
    return response
