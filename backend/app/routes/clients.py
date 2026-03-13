import base64
import json
import mimetypes
import mysql.connector
import os
import re
import unicodedata
import uuid
from datetime import date, datetime
from io import BytesIO

from flask import Blueprint, request, jsonify, send_file, current_app
from flask_jwt_extended import jwt_required
from app.database import get_db
from app.utils.auth import (
    current_user_id,
    current_user_role,
    is_admin,
    can_access_client
)
from app.utils.security import (
    add_to_trash,
    ensure_audit_logs_table,
    ensure_trash_bin_table,
    get_twofa_code_from_request,
    log_audit,
    row_to_insert_dict,
    verify_user_twofa,
)

clients_bp = Blueprint("clients", __name__)

MODULE_STORAGE_ROOT = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "storage")
)
CWD_STORAGE_ROOT = os.path.abspath(os.path.join(os.getcwd(), "storage"))


def build_storage_roots():
    roots = []
    configured_root = str(os.getenv("STORAGE_ROOT") or "").strip()
    if configured_root:
        roots.append(os.path.abspath(configured_root))

    for candidate in (MODULE_STORAGE_ROOT, CWD_STORAGE_ROOT):
        normalized = os.path.abspath(candidate)
        if normalized not in roots:
            roots.append(normalized)

    return roots


STORAGE_ROOTS = build_storage_roots()
PRIMARY_STORAGE_ROOT = STORAGE_ROOTS[0]
BASE_STORAGE = os.path.join(PRIMARY_STORAGE_ROOT, "clients")
ALLOWED_EXTENSIONS = {"pdf", "jpg", "jpeg", "png"}
DOCUMENT_BINARY_ENCODING = "base64"
DEFAULT_MONTHLY_GOAL = 20000.0
MONTH_LABELS = [
    "Jan",
    "Fev",
    "Mar",
    "Abr",
    "Mai",
    "Jun",
    "Jul",
    "Ago",
    "Set",
    "Out",
    "Nov",
    "Dez",
]

ROLE_ADMIN = "ADMIN"
ROLE_GLOBAL = "GLOBAL"
ROLE_VENDOR = "VENDEDOR"
ROLE_DIGITADOR_PORT_REFIN = "DIGITADOR_PORT_REFIN"
ROLE_DIGITADOR_NOVO_CARTAO = "DIGITADOR_NOVO_CARTAO"

DIGITADOR_PRODUCT_PERMISSIONS = {
    ROLE_DIGITADOR_PORT_REFIN: {
        "PORTABILIDADE",
        "REFINANCIAMENTO",
        "PORTABILIDADE_REFIN",
    },
    ROLE_DIGITADOR_NOVO_CARTAO: {
        "NOVO",
        "CARTAO",
    },
}

PIPELINE_ALLOWED_ROLES = {
    ROLE_GLOBAL,
    ROLE_ADMIN,
    *DIGITADOR_PRODUCT_PERMISSIONS.keys(),
}

REPORT_ALLOWED_ROLES = {
    ROLE_GLOBAL,
    ROLE_ADMIN,
    ROLE_VENDOR,
    *DIGITADOR_PRODUCT_PERMISSIONS.keys(),
}

OPERATION_VIEW_ALLOWED_ROLES = {
    ROLE_GLOBAL,
    ROLE_ADMIN,
    ROLE_VENDOR,
    *DIGITADOR_PRODUCT_PERMISSIONS.keys(),
}


# ======================================================
# UTILITÃƒÂRIOS
# ======================================================
def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def only_digits(value):
    return "".join(char for char in str(value or "") if char.isdigit())


def normalize_date_text(value):
    text = str(value or "").strip()
    if not text:
        raise ValueError("data vazia")

    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            parsed = datetime.strptime(text, fmt)
            return parsed.strftime("%Y-%m-%d")
        except ValueError:
            continue

    raise ValueError("data invalida")


def normalize_text(value):
    return str(value or "").strip()


def normalize_date_field(value):
    if value is None:
        return ""

    if isinstance(value, datetime):
        return value.date().strftime("%Y-%m-%d")

    if isinstance(value, date):
        return value.strftime("%Y-%m-%d")

    text = str(value).strip()
    if not text:
        return ""

    iso_match = re.match(r"^(\d{4})-(\d{2})-(\d{2})", text)
    if iso_match:
        return f"{iso_match.group(1)}-{iso_match.group(2)}-{iso_match.group(3)}"

    br_match = re.match(r"^(\d{2})/(\d{2})/(\d{4})$", text)
    if br_match:
        return f"{br_match.group(3)}-{br_match.group(2)}-{br_match.group(1)}"

    rfc_match = re.match(
        r"^[A-Za-z]{3},\s*(\d{1,2})\s*([A-Za-z]{3})\s*(\d{4})",
        text,
    )
    if rfc_match:
        day = int(rfc_match.group(1))
        month_abbr = rfc_match.group(2).strip().upper()
        year = int(rfc_match.group(3))
        month_map = {
            "JAN": 1,
            "FEB": 2,
            "MAR": 3,
            "APR": 4,
            "MAY": 5,
            "JUN": 6,
            "JUL": 7,
            "AUG": 8,
            "SEP": 9,
            "OCT": 10,
            "NOV": 11,
            "DEC": 12,
        }
        month = month_map.get(month_abbr)
        if month:
            try:
                return date(year, month, day).strftime("%Y-%m-%d")
            except ValueError:
                pass

    return text


def get_primary_client_folder(client_id):
    return os.path.join(BASE_STORAGE, str(client_id))


def iter_client_storage_folders(client_id):
    seen = set()
    client_id_text = str(client_id)

    for storage_root in STORAGE_ROOTS:
        folder = os.path.join(storage_root, "clients", client_id_text)
        normalized = os.path.abspath(folder)
        if normalized in seen:
            continue
        seen.add(normalized)
        yield folder


def normalize_document_filename(filename):
    return os.path.basename(str(filename or "").strip())


def infer_document_type(field_name=None, filename=None):
    field_text = str(field_name or "").strip().upper()
    if field_text:
        return field_text

    safe_filename = normalize_document_filename(filename)
    if "_" in safe_filename:
        return safe_filename.split("_", 1)[0].upper()

    stem = safe_filename.rsplit(".", 1)[0]
    return stem.upper() or "ARQUIVO"


def format_document_uploaded_at(value):
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(value, date):
        return f"{value.strftime('%Y-%m-%d')} 00:00:00"

    text = str(value or "").strip()
    if not text:
        return ""

    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt).strftime("%Y-%m-%d %H:%M:%S")
        except ValueError:
            continue

    return text


def ensure_documents_table(cursor, db):
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS documentos (
            id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            client_id INT NOT NULL,
            seller_id INT NULL,
            document_type VARCHAR(60) NULL,
            file_name VARCHAR(255) NOT NULL,
            original_name VARCHAR(255) NOT NULL,
            content_type VARCHAR(120) NULL,
            file_size INT NOT NULL DEFAULT 0,
            file_data LONGBLOB NULL,
            upload_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """
    )

    changed = False

    cursor.execute(
        """
        SELECT CONSTRAINT_NAME
        FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'documentos'
          AND REFERENCED_TABLE_NAME IS NOT NULL
        GROUP BY CONSTRAINT_NAME
        """
    )
    for row in cursor.fetchall():
        constraint_name = row.get("CONSTRAINT_NAME")
        if not constraint_name or constraint_name == "PRIMARY":
            continue
        cursor.execute(f"ALTER TABLE documentos DROP FOREIGN KEY `{constraint_name}`")
        changed = True

    cursor.execute(
        """
        SELECT
            COLUMN_NAME,
            IS_NULLABLE,
            COLUMN_TYPE,
            COLUMN_DEFAULT
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'documentos'
        """
    )
    column_rows = cursor.fetchall()
    columns = {row.get("COLUMN_NAME"): row for row in column_rows}

    column_statements = {
        "client_id": "ADD COLUMN client_id INT NOT NULL",
        "seller_id": "ADD COLUMN seller_id INT NULL",
        "document_type": "ADD COLUMN document_type VARCHAR(60) NULL",
        "file_name": "ADD COLUMN file_name VARCHAR(255) NOT NULL",
        "original_name": "ADD COLUMN original_name VARCHAR(255) NOT NULL",
        "content_type": "ADD COLUMN content_type VARCHAR(120) NULL",
        "file_size": "ADD COLUMN file_size INT NOT NULL DEFAULT 0",
        "file_data": "ADD COLUMN file_data LONGBLOB NULL",
        "upload_date": "ADD COLUMN upload_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP",
    }

    for column_name, statement in column_statements.items():
        if column_name in columns:
            continue
        cursor.execute(f"ALTER TABLE documentos {statement}")
        changed = True

    seller_meta = columns.get("seller_id") or {}
    if seller_meta.get("IS_NULLABLE") == "NO":
        cursor.execute("ALTER TABLE documentos MODIFY COLUMN seller_id INT NULL")
        changed = True

    file_data_meta = columns.get("file_data") or {}
    if file_data_meta and str(file_data_meta.get("COLUMN_TYPE") or "").lower() != "longblob":
        cursor.execute("ALTER TABLE documentos MODIFY COLUMN file_data LONGBLOB NULL")
        changed = True

    upload_date_meta = columns.get("upload_date") or {}
    if upload_date_meta and str(upload_date_meta.get("COLUMN_DEFAULT") or "").upper() != "CURRENT_TIMESTAMP":
        cursor.execute(
            "ALTER TABLE documentos MODIFY COLUMN upload_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP"
        )
        changed = True

    cursor.execute(
        """
        SELECT DISTINCT INDEX_NAME
        FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'documentos'
        """
    )
    indexes = {row.get("INDEX_NAME") for row in cursor.fetchall()}

    if "idx_documentos_client_file" not in indexes:
        cursor.execute(
            "CREATE INDEX idx_documentos_client_file ON documentos (client_id, file_name)"
        )
        changed = True

    if "idx_documentos_client_upload" not in indexes:
        cursor.execute(
            "CREATE INDEX idx_documentos_client_upload ON documentos (client_id, upload_date)"
        )
        changed = True

    if changed:
        db.commit()


def resolve_client_seller_id(cursor, client_id):
    cursor.execute(
        """
        SELECT vendedor_id
        FROM clientes
        WHERE id = %s
        LIMIT 1
        """,
        (client_id,),
    )
    row = cursor.fetchone() or {}
    seller_id = row.get("vendedor_id")
    return int(seller_id) if seller_id is not None else None


def list_client_documents_metadata_from_db(cursor, client_id):
    cursor.execute(
        """
        SELECT
            file_name,
            document_type,
            upload_date
        FROM documentos
        WHERE client_id = %s
        ORDER BY upload_date DESC, id DESC
        """,
        (client_id,),
    )
    rows = cursor.fetchall()

    documents = []
    for row in rows:
        filename = row.get("file_name") or ""
        documents.append(
            {
                "filename": filename,
                "type": row.get("document_type") or infer_document_type(filename=filename),
                "uploaded_at": format_document_uploaded_at(row.get("upload_date")),
            }
        )

    return documents


def sync_storage_documents_to_db(cursor, client_id, seller_id=None):
    client_id = int(client_id)
    if seller_id is None:
        seller_id = resolve_client_seller_id(cursor, client_id)

    cursor.execute(
        """
        SELECT file_name
        FROM documentos
        WHERE client_id = %s
        """,
        (client_id,),
    )
    existing_files = {
        normalize_document_filename(row.get("file_name")) for row in cursor.fetchall()
    }

    inserted = 0
    for client_folder in iter_client_storage_folders(client_id):
        if not os.path.isdir(client_folder):
            continue

        for filename in os.listdir(client_folder):
            safe_filename = normalize_document_filename(filename)
            if not safe_filename or safe_filename in existing_files:
                continue

            file_path = os.path.join(client_folder, safe_filename)
            if not os.path.isfile(file_path):
                continue

            with open(file_path, "rb") as storage_file:
                file_bytes = storage_file.read()

            stat_result = os.stat(file_path)
            content_type = mimetypes.guess_type(safe_filename)[0] or "application/octet-stream"
            upload_date = datetime.fromtimestamp(stat_result.st_ctime).strftime(
                "%Y-%m-%d %H:%M:%S"
            )

            cursor.execute(
                """
                INSERT INTO documentos (
                    client_id,
                    seller_id,
                    document_type,
                    file_name,
                    original_name,
                    content_type,
                    file_size,
                    file_data,
                    upload_date
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    client_id,
                    seller_id,
                    infer_document_type(filename=safe_filename),
                    safe_filename,
                    safe_filename,
                    content_type,
                    len(file_bytes),
                    file_bytes,
                    upload_date,
                ),
            )
            existing_files.add(safe_filename)
            inserted += 1

    return inserted


def list_client_documents_metadata(client_id):
    db = get_db()
    cursor = db.cursor(dictionary=True)
    try:
        ensure_documents_table(cursor, db)
        if sync_storage_documents_to_db(cursor, client_id) > 0:
            db.commit()
        return list_client_documents_metadata_from_db(cursor, client_id)
    finally:
        cursor.close()
        db.close()


def get_client_document_record(cursor, client_id, filename):
    safe_filename = normalize_document_filename(filename)
    if not safe_filename:
        return None, ""

    cursor.execute(
        """
        SELECT *
        FROM documentos
        WHERE client_id = %s
          AND file_name = %s
        ORDER BY id DESC
        LIMIT 1
        """,
        (client_id, safe_filename),
    )
    return cursor.fetchone(), safe_filename


def serialize_document_row_for_trash(row):
    payload = row_to_insert_dict(row)
    file_data = payload.get("file_data")
    if isinstance(file_data, (bytes, bytearray, memoryview)):
        payload["file_data"] = base64.b64encode(bytes(file_data)).decode("ascii")
        payload["file_data_encoding"] = DOCUMENT_BINARY_ENCODING
    return payload


def deserialize_document_row_from_trash(row):
    payload = dict(row or {})
    if payload.get("file_data_encoding") == DOCUMENT_BINARY_ENCODING:
        encoded_data = str(payload.get("file_data") or "").strip()
        payload["file_data"] = (
            base64.b64decode(encoded_data.encode("ascii")) if encoded_data else None
        )
    payload.pop("file_data_encoding", None)
    return payload


def find_client_document_file(client_id, filename):
    safe_filename = normalize_document_filename(filename)
    if not safe_filename:
        return None, ""

    for client_folder in iter_client_storage_folders(client_id):
        file_path = os.path.join(client_folder, safe_filename)
        if os.path.isfile(file_path):
            return client_folder, safe_filename

    return None, safe_filename


EMAIL_REGEX = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


PENDING_OPERATION_FIELDS = {
    "produto",
    "banco_digitacao",
    "margem",
    "prazo",
    "ficha_portabilidade",
}

PIPELINE_OPERATION_FIELDS = PENDING_OPERATION_FIELDS | {
    "valor_liberado",
    "parcela_liberada",
    "promotora",
    "status_andamento",
    "digitador_id",
    "numero_proposta",
    "status",
    "data_pagamento",
    "link_formalizacao",
    "devolvida_em",
    "formalizado_em",
    "pendencia_tipo",
    "pendencia_motivo",
    "pendencia_aberta_em",
    "pendencia_resposta_vendedor",
    "pendencia_respondida_em",
    "motivo_reprovacao",
}

FINAL_OPERATION_STATUSES = {"APROVADO", "REPROVADO"}

PIPELINE_ACTIVE_STATUSES = (
    "PRONTA_DIGITAR",
    "EM_DIGITACAO",
    "AGUARDANDO_FORMALIZACAO",
    "ANALISE_BANCO",
    "PENDENCIA",
    "DEVOLVIDA_VENDEDOR",
)

PIPELINE_ACTIVE_STATUSES_WITH_LEGACY = PIPELINE_ACTIVE_STATUSES + (
    "PENDENTE",
    "ENVIADA_ESTEIRA",
    "FORMALIZADA",
    "EM_ANALISE_BANCO",
    "PENDENTE_BANCO",
    "EM_TRATATIVA_VENDEDOR",
    "REENVIADA_BANCO",
    "EM_ANALISE",
    "DEVOLVIDA",
)

PIPELINE_READY_VISIBLE_STATUSES_WITH_LEGACY = (
    "PRONTA_DIGITAR",
    "EM_DIGITACAO",
    "PENDENTE",
    "ENVIADA_ESTEIRA",
)

VALID_PIPELINE_STATUS_UPDATES = set(PIPELINE_ACTIVE_STATUSES) | FINAL_OPERATION_STATUSES

LEGACY_STATUS_MAP = {
    "PENDENTE": "PRONTA_DIGITAR",
    "ENVIADA_ESTEIRA": "PRONTA_DIGITAR",
    "FORMALIZADA": "ANALISE_BANCO",
    "EM_ANALISE_BANCO": "ANALISE_BANCO",
    "PENDENTE_BANCO": "PENDENCIA",
    "EM_TRATATIVA_VENDEDOR": "DEVOLVIDA_VENDEDOR",
    "REENVIADA_BANCO": "ANALISE_BANCO",
    "EM_ANALISE": "ANALISE_BANCO",
    "DEVOLVIDA": "DEVOLVIDA_VENDEDOR",
}

STATUS_LABELS = {
    "PRONTA_DIGITAR": "Pronta para digitar",
    "EM_DIGITACAO": "Em digitacao",
    "AGUARDANDO_FORMALIZACAO": "Aguardando formalizacao",
    "ANALISE_BANCO": "Analise do banco",
    "PENDENCIA": "Pendencia",
    "DEVOLVIDA_VENDEDOR": "Devolvida para vendedor",
    "APROVADO": "Paga",
    "REPROVADO": "Reprovada",
}

OPERATION_PROGRESS_LABELS = {
    "AGUARDANDO_SALDO": "Aguardando saldo",
    "ANALISE_DE_CREDITO": "Analise de credito",
    "ANALISE_DOCUMENTAL": "Analise documental",
    "ANALISE_DE_SELFIE": "Analise de selfie",
    "ANALISE_DE_FORMALIZACAO": "Analise de formalizacao",
    "AGUARDANDO_AVERBACAO": "Aguardando averbacao",
    "BENEFICIO_BLOQUEADO": "Beneficio bloqueado",
    "AGUARDANDO_LIBERACAO_DA_PROMOTORA": "Aguardando liberacao da promotora",
    "ENVIADO_PARA_PAGAMENTO": "Enviado para pagamento",
}
OPERATION_PROGRESS_OPTIONS = set(OPERATION_PROGRESS_LABELS.keys())
DB_CONNECTION_ERROR_CODES = {2006, 2013, 2055}

PORTABILITY_FORM_FIELDS = (
    "titulo_produto",
    "vendedor_nome",
    "banco_nome",
    "banco_para_digitar",
    "cliente_negativo",
    "cliente_nome",
    "especie",
    "uf_beneficio",
    "numero_beneficio",
    "data_nascimento",
    "cpf",
    "rg",
    "data_emissao",
    "data_emissao_rg",
    "nome_mae",
    "telefone",
    "email",
    "analfabeto",
    "naturalidade",
    "rg_uf",
    "rg_orgao_exp",
    "salario",
    "cep",
    "endereco",
    "rua",
    "numero",
    "bairro",
    "conta",
    "agencia",
    "banco",
    "banco_codigo",
    "tipo_conta",
    "margem",
    "prazo",
    "banco_portado",
    "contrato_portado",
    "total_parcelas",
    "parcelas_pagas",
    "parcelas_restantes",
    "saldo_quitacao",
    "valor_parcela",
)

PROMOTORA_OPTIONS = {
    "AMF",
    "FINANBANK",
    "PROSPECTA",
    "IDEIA",
    "PORT",
}


def build_operation_update(data, allowed_fields):
    updates = []
    params = []

    for field in allowed_fields:
        if field in data:
            updates.append(f"{field}=%s")
            params.append(data.get(field))

    return updates, params


def normalize_portability_form(payload):
    if payload is None:
        return None

    if isinstance(payload, str):
        text = payload.strip()
        if not text:
            return None

        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            return None

    if not isinstance(payload, dict):
        return None

    normalized = {}

    for field in PORTABILITY_FORM_FIELDS:
        value = payload.get(field, "")

        if value is None:
            normalized[field] = ""
        elif isinstance(value, (int, float)):
            normalized[field] = value
        else:
            normalized[field] = str(value).strip()

    return normalized


def serialize_portability_form(payload):
    normalized = normalize_portability_form(payload)

    if not normalized:
        return None

    if not any(str(value).strip() for value in normalized.values()):
        return None

    return json.dumps(normalized, ensure_ascii=False)


def hydrate_operation_payload(operation):
    if not isinstance(operation, dict):
        return operation

    operation["ficha_portabilidade"] = normalize_portability_form(
        operation.get("ficha_portabilidade")
    )
    return operation


def normalize_role(role):
    return (role or "").strip().upper()


def is_admin_like_role(role):
    return normalize_role(role) in {ROLE_ADMIN, ROLE_GLOBAL}


def require_global_twofa(cursor, actor_id):
    code = get_twofa_code_from_request()
    valid, error_message = verify_user_twofa(cursor, actor_id, code)
    if valid:
        return None
    return jsonify({"error": error_message}), 403


def normalize_operation_status(status):
    normalized = (status or "").strip().upper()
    return LEGACY_STATUS_MAP.get(normalized, normalized)


def format_operation_status_label(status):
    normalized = normalize_operation_status(status)
    if not normalized:
        return "-"
    return STATUS_LABELS.get(normalized, normalized.replace("_", " ").title())


def normalize_operation_progress_status(status):
    text = str(status or "").strip()
    if not text:
        return ""

    text = unicodedata.normalize("NFKD", text)
    text = "".join(char for char in text if not unicodedata.combining(char))
    text = re.sub(r"\s+", "_", text.upper())
    return text


def format_operation_progress_label(status):
    normalized = normalize_operation_progress_status(status)
    if not normalized:
        return "Sem andamento"
    return OPERATION_PROGRESS_LABELS.get(
        normalized, normalized.replace("_", " ").title()
    )


def normalize_product_name(product):
    return (product or "").strip().upper()


def is_digitador_role(role):
    return normalize_role(role) in DIGITADOR_PRODUCT_PERMISSIONS


def allowed_products_for_role(role):
    products = DIGITADOR_PRODUCT_PERMISSIONS.get(normalize_role(role))
    if not products:
        return ()
    return tuple(sorted(products))


def role_can_access_operation(role, user_id, operation):
    normalized_role = normalize_role(role)

    if is_admin_like_role(normalized_role):
        return True

    if normalized_role == ROLE_VENDOR:
        return operation.get("vendedor_id") == user_id

    products = allowed_products_for_role(normalized_role)
    if not products:
        return False

    return normalize_product_name(operation.get("produto")) in products


def can_access_client_documents(client_id):
    if can_access_client(client_id):
        return True

    role = normalize_role(current_user_role())
    if not is_digitador_role(role):
        return False

    conditions = []
    params = [client_id]
    apply_role_product_scope(role, conditions, params, "o.produto")
    if not conditions:
        return False

    where_clause = " AND ".join(conditions)

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        cursor.execute(
            f"""
            SELECT 1
            FROM operacoes o
            WHERE o.cliente_id = %s
              AND {where_clause}
            LIMIT 1
            """,
            tuple(params),
        )
        return cursor.fetchone() is not None
    finally:
        cursor.close()
        db.close()


def apply_role_product_scope(role, conditions, params, column_name):
    products = allowed_products_for_role(role)
    if not products:
        return

    placeholders = ", ".join(["%s"] * len(products))
    conditions.append(f"UPPER({column_name}) IN ({placeholders})")
    params.extend(products)


def parse_dashboard_period(month, year):
    if month < 1 or month > 12:
        return None, None, "Mes invalido. Use um valor entre 1 e 12."

    if year < 2000 or year > 2100:
        return None, None, "Ano invalido."

    period_start = datetime(year, month, 1)

    if month == 12:
        period_end = datetime(year + 1, 1, 1)
    else:
        period_end = datetime(year, month + 1, 1)

    return period_start, period_end, None


def normalize_optional_email(value):
    email = normalize_text(value).lower()
    if not email:
        return ""
    if not EMAIL_REGEX.match(email):
        raise ValueError("email invalido")
    return email


def parse_flexible_decimal(value):
    if value is None:
        raise ValueError("valor ausente")

    if isinstance(value, (int, float)):
        return float(value)

    text = str(value).strip()
    if not text:
        raise ValueError("valor vazio")

    cleaned = re.sub(r"[^\d,.\-\s]", "", text).replace(" ", "")
    if not cleaned:
        raise ValueError("valor invalido")

    last_comma = cleaned.rfind(",")
    last_dot = cleaned.rfind(".")
    decimal_index = max(last_comma, last_dot)

    sign = "-" if cleaned.startswith("-") else ""
    unsigned = cleaned[1:] if sign else cleaned
    decimal_index_unsigned = decimal_index - (1 if sign else 0)

    if decimal_index_unsigned >= 0:
        integer_part = re.sub(r"[.,]", "", unsigned[:decimal_index_unsigned])
        decimal_part = re.sub(r"[.,]", "", unsigned[decimal_index_unsigned + 1 :])
        normalized = (
            f"{sign}{integer_part or '0'}.{decimal_part}"
            if decimal_part
            else f"{sign}{integer_part or '0'}"
        )
    else:
        normalized = cleaned.replace(",", ".")

    return float(normalized)


def normalize_optional_boolean(value):
    if value in (None, "", []):
        return False
    if isinstance(value, bool):
        return value

    text = str(value).strip().lower()
    return text in {"1", "true", "sim", "yes", "on"}


def ensure_dashboard_goals_table(cursor, db):
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS dashboard_goals (
            id INT AUTO_INCREMENT PRIMARY KEY,
            year INT NOT NULL,
            month INT NOT NULL,
            vendedor_id INT NOT NULL DEFAULT 0,
            target DECIMAL(14,2) NOT NULL,
            updated_by INT NULL,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uk_dashboard_goal_scope (year, month, vendedor_id)
        )
        """
    )
    db.commit()


def ensure_clients_extra_columns(cursor, db):
    cursor.execute(
        """
        SELECT
            COLUMN_NAME,
            DATA_TYPE,
            CHARACTER_MAXIMUM_LENGTH
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'clientes'
          AND COLUMN_NAME IN ('email', 'analfabeto')
        """
    )

    existing = {row["COLUMN_NAME"]: row for row in cursor.fetchall()}
    changed = False
    email_column = existing.get("email")
    analfabeto_column = existing.get("analfabeto")

    if not email_column:
        cursor.execute(
            "ALTER TABLE clientes ADD COLUMN email VARCHAR(180) NULL AFTER telefone"
        )
        changed = True
    else:
        email_type = str(email_column.get("DATA_TYPE") or "").lower()
        email_len = email_column.get("CHARACTER_MAXIMUM_LENGTH") or 0
        if email_type != "varchar" or email_len < 180:
            cursor.execute("ALTER TABLE clientes MODIFY COLUMN email VARCHAR(180) NULL")
            changed = True

    if not analfabeto_column:
        cursor.execute(
            "ALTER TABLE clientes ADD COLUMN analfabeto TINYINT(1) NOT NULL DEFAULT 0 AFTER email"
        )
        changed = True
    else:
        analfabeto_type = str(analfabeto_column.get("DATA_TYPE") or "").lower()
        if analfabeto_type not in {"tinyint", "bit", "boolean"}:
            cursor.execute(
                "ALTER TABLE clientes MODIFY COLUMN analfabeto TINYINT(1) NOT NULL DEFAULT 0"
            )
            changed = True

    if changed:
        db.commit()


def ensure_operations_extra_columns(cursor, db):
    cursor.execute(
        """
        SELECT
            COLUMN_NAME,
            DATA_TYPE,
            CHARACTER_MAXIMUM_LENGTH
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'operacoes'
          AND COLUMN_NAME IN (
              'status',
              'enviada_esteira_em',
              'link_formalizacao',
              'devolvida_em',
              'ficha_portabilidade',
              'formalizado_em',
              'pendencia_tipo',
              'pendencia_motivo',
              'pendencia_aberta_em',
              'pendencia_resposta_vendedor',
              'pendencia_respondida_em',
              'motivo_reprovacao',
              'digitador_id',
              'numero_proposta',
              'promotora',
              'status_andamento'
          )
        """
    )

    existing = {row["COLUMN_NAME"]: row for row in cursor.fetchall()}
    changed = False

    status_column = existing.get("status")
    if status_column:
        status_type = str(status_column.get("DATA_TYPE") or "").lower()
        status_len = status_column.get("CHARACTER_MAXIMUM_LENGTH") or 0

        if status_type != "varchar" or status_len < 50:
            cursor.execute(
                "ALTER TABLE operacoes MODIFY COLUMN status VARCHAR(50) NOT NULL"
            )
            changed = True

    if "link_formalizacao" not in existing:
        cursor.execute(
            "ALTER TABLE operacoes ADD COLUMN link_formalizacao VARCHAR(500) NULL"
        )
        changed = True

    if "enviada_esteira_em" not in existing:
        cursor.execute(
            "ALTER TABLE operacoes ADD COLUMN enviada_esteira_em DATETIME NULL"
        )
        changed = True

    if "devolvida_em" not in existing:
        cursor.execute(
            "ALTER TABLE operacoes ADD COLUMN devolvida_em DATETIME NULL"
        )
        changed = True

    if "ficha_portabilidade" not in existing:
        cursor.execute(
            "ALTER TABLE operacoes ADD COLUMN ficha_portabilidade LONGTEXT NULL"
        )
        changed = True

    if "formalizado_em" not in existing:
        cursor.execute(
            "ALTER TABLE operacoes ADD COLUMN formalizado_em DATETIME NULL"
        )
        changed = True

    if "pendencia_tipo" not in existing:
        cursor.execute(
            "ALTER TABLE operacoes ADD COLUMN pendencia_tipo VARCHAR(120) NULL"
        )
        changed = True

    if "pendencia_motivo" not in existing:
        cursor.execute(
            "ALTER TABLE operacoes ADD COLUMN pendencia_motivo TEXT NULL"
        )
        changed = True

    if "pendencia_aberta_em" not in existing:
        cursor.execute(
            "ALTER TABLE operacoes ADD COLUMN pendencia_aberta_em DATETIME NULL"
        )
        changed = True

    if "pendencia_resposta_vendedor" not in existing:
        cursor.execute(
            "ALTER TABLE operacoes ADD COLUMN pendencia_resposta_vendedor TEXT NULL"
        )
        changed = True

    if "pendencia_respondida_em" not in existing:
        cursor.execute(
            "ALTER TABLE operacoes ADD COLUMN pendencia_respondida_em DATETIME NULL"
        )
        changed = True

    if "motivo_reprovacao" not in existing:
        cursor.execute(
            "ALTER TABLE operacoes ADD COLUMN motivo_reprovacao TEXT NULL"
        )
        changed = True

    if "digitador_id" not in existing:
        cursor.execute("ALTER TABLE operacoes ADD COLUMN digitador_id INT NULL")
        changed = True

    if "numero_proposta" not in existing:
        cursor.execute("ALTER TABLE operacoes ADD COLUMN numero_proposta VARCHAR(120) NULL")
        changed = True

    if "promotora" not in existing:
        cursor.execute("ALTER TABLE operacoes ADD COLUMN promotora VARCHAR(80) NULL")
        changed = True

    if "status_andamento" not in existing:
        cursor.execute("ALTER TABLE operacoes ADD COLUMN status_andamento VARCHAR(80) NULL")
        changed = True

    if changed:
        db.commit()


def ensure_operation_comments_table(cursor, db):
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS operation_comments (
            id INT AUTO_INCREMENT PRIMARY KEY,
            operation_id INT NOT NULL,
            author_id INT NOT NULL,
            message TEXT NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_operation_comments_operation_created (operation_id, created_at)
        )
        """
    )
    db.commit()


def ensure_operation_status_history_table(cursor, db):
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS operation_status_history (
            id INT AUTO_INCREMENT PRIMARY KEY,
            operation_id INT NOT NULL,
            previous_status VARCHAR(50) NULL,
            next_status VARCHAR(50) NOT NULL,
            changed_by INT NULL,
            changed_by_role VARCHAR(30) NULL,
            note TEXT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_operation_status_history_operation_created (operation_id, created_at)
        )
        """
    )
    db.commit()


def ensure_operation_notifications_table(cursor, db):
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS operation_notifications (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            operation_id INT NOT NULL,
            previous_status VARCHAR(50) NULL,
            next_status VARCHAR(50) NOT NULL,
            title VARCHAR(180) NOT NULL,
            message TEXT NOT NULL,
            read_at DATETIME NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_operation_notifications_user_read_created (user_id, read_at, created_at),
            INDEX idx_operation_notifications_operation_created (operation_id, created_at)
        )
        """
    )
    db.commit()


def register_operation_status_history(
    cursor,
    operation_id,
    previous_status,
    next_status,
    changed_by=None,
    changed_by_role="",
    note=None,
):
    normalized_next = normalize_operation_status(next_status)

    if not normalized_next:
        return

    normalized_previous = normalize_operation_status(previous_status)
    role_value = (changed_by_role or "").strip().upper()
    note_value = str(note or "").strip() or None

    cursor.execute(
        """
        INSERT INTO operation_status_history (
            operation_id,
            previous_status,
            next_status,
            changed_by,
            changed_by_role,
            note
        )
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (
            operation_id,
            normalized_previous or None,
            normalized_next,
            changed_by,
            role_value,
            note_value,
        ),
    )


def get_user_display_name(cursor, user_id):
    user_id = to_int(user_id)
    if user_id <= 0:
        return ""

    cursor.execute(
        """
        SELECT COALESCE(nome, 'Usuario') AS nome
        FROM usuarios
        WHERE id = %s
        LIMIT 1
        """,
        (user_id,),
    )
    row = cursor.fetchone() or {}
    return str(row.get("nome") or "").strip()


def collect_operation_notification_recipients(
    cursor,
    operation,
    include_vendor=True,
    include_assigned_digitador=True,
    include_admins=True,
    include_product_digitadores=True,
):
    recipients = set()
    operation = operation or {}

    if include_vendor:
        vendedor_id = to_int(operation.get("vendedor_id"))
        if vendedor_id > 0:
            recipients.add(vendedor_id)

    if include_assigned_digitador:
        digitador_id = to_int(operation.get("digitador_id"))
        if digitador_id > 0:
            recipients.add(digitador_id)

    if include_admins:
        cursor.execute(
            """
            SELECT id
            FROM usuarios
            WHERE UPPER(role) IN ('ADMIN', 'GLOBAL')
            """
        )
        for row in cursor.fetchall() or []:
            user_id = to_int(row.get("id"))
            if user_id > 0:
                recipients.add(user_id)

    if include_product_digitadores:
        product_name = normalize_product_name(operation.get("produto"))
        digitador_roles = [
            role_name
            for role_name, products in DIGITADOR_PRODUCT_PERMISSIONS.items()
            if product_name in products
        ]

        if digitador_roles:
            placeholders = ", ".join(["%s"] * len(digitador_roles))
            cursor.execute(
                f"""
                SELECT id
                FROM usuarios
                WHERE UPPER(role) IN ({placeholders})
                """,
                tuple(digitador_roles),
            )
            for row in cursor.fetchall() or []:
                user_id = to_int(row.get("id"))
                if user_id > 0:
                    recipients.add(user_id)

    return recipients


def insert_operation_notifications(
    cursor,
    user_ids,
    operation_id,
    previous_status,
    next_status,
    title,
    message,
):
    if not user_ids:
        return

    operation_id = to_int(operation_id)
    if operation_id <= 0:
        return

    normalized_next = normalize_operation_status(next_status) or "PRONTA_DIGITAR"
    normalized_previous = (
        normalize_operation_status(previous_status) if previous_status else None
    )
    title_text = str(title or "Atualizacao de operacao").strip() or "Atualizacao de operacao"
    message_text = str(message or "").strip() or "Houve uma atualizacao na operacao."

    rows = []
    for user_id in user_ids:
        normalized_user_id = to_int(user_id)
        if normalized_user_id <= 0:
            continue
        rows.append(
            (
                normalized_user_id,
                operation_id,
                normalized_previous,
                normalized_next,
                title_text,
                message_text,
            )
        )

    if not rows:
        return

    cursor.executemany(
        """
        INSERT INTO operation_notifications (
            user_id,
            operation_id,
            previous_status,
            next_status,
            title,
            message
        )
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        rows,
    )


def notify_vendor_status_change(
    cursor,
    operation_id,
    previous_status,
    next_status,
    changed_by=None,
):
    normalized_previous = normalize_operation_status(previous_status)
    normalized_next = normalize_operation_status(next_status)

    if not normalized_next or normalized_previous == normalized_next:
        return

    cursor.execute(
        """
        SELECT
            c.vendedor_id,
            o.digitador_id,
            COALESCE(c.nome, 'Cliente') AS cliente_nome,
            COALESCE(o.produto, 'OPERACAO') AS produto
        FROM operacoes o
        JOIN clientes c ON c.id = o.cliente_id
        WHERE o.id = %s
        LIMIT 1
        """,
        (operation_id,),
    )
    operation = cursor.fetchone() or {}
    recipients = collect_operation_notification_recipients(
        cursor,
        operation,
        include_vendor=True,
        include_assigned_digitador=True,
        include_admins=True,
        include_product_digitadores=True,
    )

    if changed_by:
        recipients.discard(to_int(changed_by))

    if not recipients:
        return

    actor_name = get_user_display_name(cursor, changed_by)

    cliente_nome = str(operation.get("cliente_nome") or "Cliente").strip() or "Cliente"
    produto = normalize_product_name(operation.get("produto")) or "OPERACAO"
    previous_label = format_operation_status_label(normalized_previous)
    next_label = format_operation_status_label(normalized_next)
    actor_suffix = f" por {actor_name}" if actor_name else ""

    title = f"Status da operacao #{operation_id} atualizado"
    message = (
        f"{cliente_nome} ({produto}): {previous_label} -> {next_label}{actor_suffix}"
        if normalized_previous
        else f"{cliente_nome} ({produto}): {next_label}{actor_suffix}"
    )

    insert_operation_notifications(
        cursor,
        recipients,
        operation_id,
        normalized_previous,
        normalized_next,
        title,
        message,
    )


def notify_vendor_progress_change(
    cursor,
    operation_id,
    previous_progress,
    next_progress,
    changed_by=None,
):
    normalized_previous = normalize_operation_progress_status(previous_progress)
    normalized_next = normalize_operation_progress_status(next_progress)

    if normalized_previous == normalized_next:
        return

    cursor.execute(
        """
        SELECT
            c.vendedor_id,
            COALESCE(c.nome, 'Cliente') AS cliente_nome,
            COALESCE(o.produto, 'OPERACAO') AS produto,
            o.status
        FROM operacoes o
        JOIN clientes c ON c.id = o.cliente_id
        WHERE o.id = %s
        LIMIT 1
        """,
        (operation_id,),
    )
    operation = cursor.fetchone() or {}
    vendedor_id = to_int(operation.get("vendedor_id"))
    if vendedor_id <= 0:
        return

    recipients = {vendedor_id}
    if changed_by:
        recipients.discard(to_int(changed_by))
    if not recipients:
        return

    actor_name = get_user_display_name(cursor, changed_by)
    actor_suffix = f" por {actor_name}" if actor_name else ""
    cliente_nome = str(operation.get("cliente_nome") or "Cliente").strip() or "Cliente"
    produto = normalize_product_name(operation.get("produto")) or "OPERACAO"
    previous_label = format_operation_progress_label(normalized_previous)
    next_label = format_operation_progress_label(normalized_next)
    operation_status = normalize_operation_status(operation.get("status")) or "ANALISE_BANCO"

    title = f"Andamento da operacao #{operation_id} atualizado"
    message = f"{cliente_nome} ({produto}): {previous_label} -> {next_label}{actor_suffix}"

    insert_operation_notifications(
        cursor,
        recipients,
        operation_id,
        operation_status,
        operation_status,
        title,
        message,
    )


def notify_operation_comment(
    cursor,
    operation_id,
    operation,
    author_id=None,
    author_name="",
    comment_message="",
):
    operation = operation or {}
    operation_status = normalize_operation_status(operation.get("status")) or "PRONTA_DIGITAR"
    recipients = collect_operation_notification_recipients(
        cursor,
        operation,
        include_vendor=True,
        include_assigned_digitador=True,
        include_admins=True,
        include_product_digitadores=True,
    )

    if author_id:
        recipients.discard(to_int(author_id))

    if not recipients:
        return

    author_display = str(author_name or "").strip() or "Usuario"
    cliente_nome = str(operation.get("cliente_nome") or "Cliente").strip() or "Cliente"
    produto = normalize_product_name(operation.get("produto")) or "OPERACAO"
    compact_comment = " ".join(str(comment_message or "").split())
    if len(compact_comment) > 140:
        compact_comment = f"{compact_comment[:137]}..."

    title = f"Novo comentario na operacao #{operation_id}"
    message = f"{author_display} comentou em {cliente_nome} ({produto})"
    if compact_comment:
        message = f'{message}: "{compact_comment}"'

    insert_operation_notifications(
        cursor,
        recipients,
        operation_id,
        operation_status,
        operation_status,
        title,
        message,
    )


def notify_operation_arrived_pipeline(
    cursor,
    operation_id,
    operation,
    changed_by=None,
):
    operation = operation or {}
    recipients = collect_operation_notification_recipients(
        cursor,
        operation,
        include_vendor=False,
        include_assigned_digitador=True,
        include_admins=True,
        include_product_digitadores=True,
    )

    if changed_by:
        recipients.discard(to_int(changed_by))

    if not recipients:
        return

    actor_name = get_user_display_name(cursor, changed_by)
    actor_suffix = f" por {actor_name}" if actor_name else ""
    cliente_nome = str(operation.get("cliente_nome") or "Cliente").strip() or "Cliente"
    produto = normalize_product_name(operation.get("produto")) or "OPERACAO"
    current_status = normalize_operation_status(operation.get("status")) or "PRONTA_DIGITAR"

    title = f"Nova operacao na esteira #{operation_id}"
    message = f"{cliente_nome} ({produto}) entrou na esteira{actor_suffix}."

    insert_operation_notifications(
        cursor,
        recipients,
        operation_id,
        None,
        current_status,
        title,
        message,
    )


def to_int(value):
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def is_transient_db_connection_error(error):
    if not isinstance(error, mysql.connector.Error):
        return False

    if getattr(error, "errno", None) in DB_CONNECTION_ERROR_CODES:
        return True

    message = str(error or "").lower()
    return (
        "lost connection" in message
        or "conexao com o servidor mysql perdida" in message
        or "can't connect to mysql server" in message
    )


def to_number(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def serialize_client_record(client):
    if not client:
        return client

    client["data_nascimento"] = normalize_date_field(client.get("data_nascimento"))
    client["rg_data_emissao"] = normalize_date_field(client.get("rg_data_emissao"))
    client["analfabeto"] = bool(to_int(client.get("analfabeto")))
    return client


def fetch_client_record(cursor, client_id):
    cursor.execute(
        """
        SELECT
            c.*,
            COALESCE(u.nome, '-') AS vendedor_nome
        FROM clientes c
        LEFT JOIN usuarios u ON u.id = c.vendedor_id
        WHERE c.id = %s
        LIMIT 1
        """,
        (client_id,),
    )
    return serialize_client_record(cursor.fetchone())


def resolve_dashboard_goal(cursor, year, month, vendedor_id):
    if vendedor_id:
        cursor.execute(
            """
            SELECT target
            FROM dashboard_goals
            WHERE year=%s AND month=%s AND vendedor_id=%s
            LIMIT 1
            """,
            (year, month, vendedor_id),
        )
        row = cursor.fetchone()
        if row:
            target = max(1.0, to_number(row.get("target")))
            return target, "VENDEDOR"

    cursor.execute(
        """
        SELECT target
        FROM dashboard_goals
        WHERE year=%s AND month=%s AND vendedor_id=0
        LIMIT 1
        """,
        (year, month),
    )
    row = cursor.fetchone()
    if row:
        target = max(1.0, to_number(row.get("target")))
        return target, "GERAL"

    return DEFAULT_MONTHLY_GOAL, "PADRAO"


# ======================================================
# Ã¢Å¾â€¢ CRIAR CLIENTE
# ======================================================
@clients_bp.route("/clients", methods=["POST"])
@jwt_required()
def create_client():
    

    data = request.get_json() or {}

    role = (current_user_role() or "").upper()
    user_id = current_user_id()

    if role not in {ROLE_ADMIN, ROLE_GLOBAL, ROLE_VENDOR}:
        return jsonify({"error": "Permissao negada"}), 403

    if role == ROLE_VENDOR:
        vendedor_id = user_id
    else:
        raw_vendedor_id = data.get("vendedor_id")
        try:
            vendedor_id = int(raw_vendedor_id)
        except (TypeError, ValueError):
            vendedor_id = 0

    if not vendedor_id:
        return jsonify({"error": "vendedor_id e obrigatorio"}), 400

    required_fields = [
        "nome",
        "cpf",
        "data_nascimento",
        "especie",
        "uf_beneficio",
        "numero_beneficio",
        "salario",
        "nome_mae",
        "rg_numero",
        "rg_orgao_exp",
        "rg_uf",
        "rg_data_emissao",
        "naturalidade",
        "telefone",
        "cep",
        "rua",
        "numero",
        "bairro",
    ]

    missing_fields = []
    for field in required_fields:
        value = data.get(field)
        if value is None or str(value).strip() == "":
            missing_fields.append(field)

    if missing_fields:
        return jsonify({
            "error": "Campos obrigatorios faltando",
            "fields": missing_fields
        }), 400

    try:
        salario = parse_flexible_decimal(data.get("salario"))
    except (TypeError, ValueError):
        return jsonify({"error": "salario invalido"}), 400

    cpf = only_digits(data.get("cpf"))
    if len(cpf) != 11:
        return jsonify({"error": "cpf invalido. Informe 11 digitos"}), 400

    cep = only_digits(data.get("cep"))
    if len(cep) != 8:
        return jsonify({"error": "cep invalido. Informe 8 digitos"}), 400

    uf_beneficio = str(data.get("uf_beneficio") or "").strip().upper()
    if len(uf_beneficio) != 2:
        return jsonify({"error": "uf_beneficio invalida. Use 2 letras"}), 400

    rg_uf = str(data.get("rg_uf") or "").strip().upper()
    if len(rg_uf) != 2:
        return jsonify({"error": "rg_uf invalida. Use 2 letras"}), 400

    try:
        data_nascimento = normalize_date_text(data.get("data_nascimento"))
        rg_data_emissao = normalize_date_text(data.get("rg_data_emissao"))
    except ValueError:
        return jsonify({"error": "Data invalida. Use DD/MM/AAAA ou AAAA-MM-DD"}), 400

    nome = normalize_text(data.get("nome"))
    especie = normalize_text(data.get("especie"))
    numero_beneficio = normalize_text(data.get("numero_beneficio"))
    nome_mae = normalize_text(data.get("nome_mae"))
    rg_numero = normalize_text(data.get("rg_numero"))
    rg_orgao_exp = normalize_text(data.get("rg_orgao_exp"))
    naturalidade = normalize_text(data.get("naturalidade"))
    telefone = only_digits(data.get("telefone"))
    try:
        email = normalize_optional_email(data.get("email"))
    except ValueError:
        return jsonify({"error": "email invalido"}), 400
    analfabeto = 1 if normalize_optional_boolean(data.get("analfabeto")) else 0
    rua = normalize_text(data.get("rua"))
    numero = normalize_text(data.get("numero"))
    bairro = normalize_text(data.get("bairro"))

    if len(telefone) < 10:
        return jsonify({"error": "telefone invalido. Informe DDD e numero"}), 400

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        ensure_clients_extra_columns(cursor, db)
        cursor.execute(
            """
            SELECT
                COLUMN_NAME,
                CHARACTER_MAXIMUM_LENGTH
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'clientes'
            """
        )
        column_meta = {
            row["COLUMN_NAME"]: row.get("CHARACTER_MAXIMUM_LENGTH")
            for row in cursor.fetchall()
        }

        base_columns = [
            "vendedor_id",
            "nome",
            "cpf",
            "data_nascimento",
            "especie",
            "uf_beneficio",
            "numero_beneficio",
            "salario",
            "nome_mae",
            "rg_numero",
            "rg_orgao_exp",
            "rg_uf",
            "rg_data_emissao",
            "naturalidade",
            "telefone",
            "email",
            "analfabeto",
            "cep",
        ]
        missing_base_columns = [
            column_name for column_name in base_columns if column_name not in column_meta
        ]
        if missing_base_columns:
            return jsonify({
                "error": "Estrutura da tabela clientes desatualizada",
                "fields": missing_base_columns,
            }), 500

        use_split_address = all(
            column_name in column_meta for column_name in ("rua", "numero", "bairro")
        )
        use_legacy_address = all(
            column_name in column_meta for column_name in ("endereco", "bairro")
        )

        if use_split_address:
            address_columns = ["rua", "numero", "bairro"]
            address_values = [rua, numero, bairro]
        elif use_legacy_address:
            address_columns = ["endereco", "bairro"]
            composed_address = ", ".join(part for part in (rua, numero) if part).strip()
            address_values = [composed_address, bairro]
        else:
            return jsonify({
                "error": "Estrutura da tabela clientes invalida para endereco",
            }), 500

        string_values = {
            "nome": nome,
            "cpf": cpf,
            "especie": especie,
            "uf_beneficio": uf_beneficio,
            "numero_beneficio": numero_beneficio,
            "nome_mae": nome_mae,
            "rg_numero": rg_numero,
            "rg_orgao_exp": rg_orgao_exp,
            "rg_uf": rg_uf,
            "naturalidade": naturalidade,
            "telefone": telefone,
            "email": email,
            "cep": cep,
            **dict(zip(address_columns, address_values)),
        }

        for column_name, value in string_values.items():
            max_length = column_meta.get(column_name)
            if max_length and len(str(value)) > int(max_length):
                return jsonify({
                    "error": f"{column_name} excede o limite de {int(max_length)} caracteres",
                }), 400

        insert_columns = base_columns + address_columns
        insert_values = [
            vendedor_id,
            nome,
            cpf,
            data_nascimento,
            especie,
            uf_beneficio,
            numero_beneficio,
            salario,
            nome_mae,
            rg_numero,
            rg_orgao_exp,
            rg_uf,
            rg_data_emissao,
            naturalidade,
            telefone,
            email or None,
            analfabeto,
            cep,
            *address_values,
        ]

        columns_sql = ",\n                ".join(insert_columns)
        placeholders_sql = ", ".join(["%s"] * len(insert_columns))

        cursor.execute(
            f"""
            INSERT INTO clientes (
                {columns_sql}
            ) VALUES (
                {placeholders_sql}
            )
            """,
            tuple(insert_values),
        )

        db.commit()
        client_id = cursor.lastrowid

        return jsonify({
            "message": "Cliente criado com sucesso",
            "client_id": client_id
        }), 201
    except Exception as exc:
        db.rollback()
        message = str(exc)

        if "Duplicate entry" in message and "cpf" in message.lower():
            return jsonify({"error": "CPF ja cadastrado"}), 409

        if "Incorrect date value" in message:
            return jsonify({"error": "Data invalida"}), 400

        data_too_long_match = re.search(
            r"Data too long for column '([^']+)'",
            message,
            flags=re.IGNORECASE,
        )
        if data_too_long_match:
            field_name = data_too_long_match.group(1)
            return jsonify({
                "error": f"{field_name} excede o limite permitido",
            }), 400

        if "Cannot add or update a child row" in message:
            return jsonify({"error": "vendedor_id invalido"}), 400

        return jsonify({"error": "Erro ao criar cliente"}), 500
    finally:
        cursor.close()
        db.close()


# ======================================================
# Ã°Å¸â€œÆ’ CRIAR OPERAÃƒâ€¡Ãƒâ€¢ES
# ======================================================

@clients_bp.route("/clients/<int:client_id>/operations", methods=["POST"])
@jwt_required()
def create_operation(client_id):
    role = normalize_role(current_user_role())
    user_id = current_user_id()

    if role not in {ROLE_ADMIN, ROLE_GLOBAL, ROLE_VENDOR}:
        return jsonify({"error": "Acesso nao autorizado"}), 403

    if not can_access_client(client_id):
        return jsonify({"error": "Acesso nÃƒÂ£o autorizado"}), 403

    data = request.get_json() or {}
    produto = (data.get("produto") or "").strip().upper()
    banco_digitacao = normalize_text(data.get("banco_digitacao"))
    ficha_portabilidade = None

    if not banco_digitacao:
        return jsonify({"error": "banco_digitacao obrigatorio"}), 400

    if produto in {"PORTABILIDADE", "PORTABILIDADE_REFIN"} or "ficha_portabilidade" in data:
        ficha_portabilidade = serialize_portability_form(data.get("ficha_portabilidade"))

    db = get_db()
    cursor = db.cursor(dictionary=True)
    ensure_operations_extra_columns(cursor, db)
    ensure_operation_status_history_table(cursor, db)
    ensure_operation_notifications_table(cursor, db)

    cursor.execute("""
        INSERT INTO operacoes (
            cliente_id,
            produto,
            banco_digitacao,
            margem,
            prazo,
            valor_solicitado,
            parcela_solicitada,
            ficha_portabilidade,
            status,
            criado_em
        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'PRONTA_DIGITAR', NOW())
    """, (
        client_id,
        produto,
        banco_digitacao,
        data.get("margem"),
        data.get("prazo"),
        data.get("valor_solicitado"),
        data.get("parcela_solicitada"),
        ficha_portabilidade,
    ))

    operation_id = cursor.lastrowid
    register_operation_status_history(
        cursor,
        operation_id,
        None,
        "PRONTA_DIGITAR",
        changed_by=user_id,
        changed_by_role=role,
        note="Operacao criada",
    )
    db.commit()

    cursor.close()
    db.close()

    return jsonify({
        "message": "OperaÃƒÂ§ÃƒÂ£o criada com sucesso",
        "operation_id": operation_id
    }), 201


# ======================================================
# Ã°Å¸â€œÆ’ LISTAR CLIENTES
# ======================================================
@clients_bp.route("/clients", methods=["GET"])
@jwt_required()
def list_clients():
    db = get_db()
    cursor = db.cursor(dictionary=True)
    ensure_clients_extra_columns(cursor, db)

    if is_admin():
        cursor.execute("""
            SELECT 
                c.*,
                (
                    SELECT o.status
                    FROM operacoes o
                    WHERE o.cliente_id = c.id
                    ORDER BY o.criado_em DESC
                    LIMIT 1
                ) AS last_operation_status
            FROM clientes c
            ORDER BY c.criado_em DESC
        """)
    else:
        cursor.execute("""
            SELECT 
                c.*,
                (
                    SELECT o.status
                    FROM operacoes o
                    WHERE o.cliente_id = c.id
                    ORDER BY o.criado_em DESC
                    LIMIT 1
                ) AS last_operation_status
            FROM clientes c
            WHERE c.vendedor_id=%s
            ORDER BY c.criado_em DESC
        """, (current_user_id(),))

    clients = cursor.fetchall()
    for client in clients:
        client["data_nascimento"] = normalize_date_field(client.get("data_nascimento"))
        client["rg_data_emissao"] = normalize_date_field(client.get("rg_data_emissao"))
        client["analfabeto"] = bool(to_int(client.get("analfabeto")))

    cursor.close()
    db.close()

    return jsonify(clients), 200


# ======================================================
# BUSCA GLOBAL
# ======================================================
@clients_bp.route("/search/global", methods=["GET"])
@jwt_required()
def search_global():
    role = normalize_role(current_user_role())
    user_id = current_user_id()

    if role not in OPERATION_VIEW_ALLOWED_ROLES:
        return jsonify({"error": "Acesso nao autorizado"}), 403

    query = normalize_text(request.args.get("q"))
    limit = request.args.get("limit", type=int) or 8
    limit = max(1, min(limit, 20))

    if len(query) < 2:
        return jsonify({"query": query, "clients": []}), 200

    like_term = f"%{query}%"
    only_digits_term = only_digits(query)
    digit_like_term = f"%{only_digits_term}%" if only_digits_term else like_term

    db = get_db()
    cursor = db.cursor(dictionary=True)
    ensure_operations_extra_columns(cursor, db)

    try:
        base_where = [
            "("
            "c.nome LIKE %s OR "
            "c.cpf LIKE %s OR "
            "REPLACE(REPLACE(c.cpf, '.', ''), '-', '') LIKE %s OR "
            "c.numero_beneficio LIKE %s"
            ")"
        ]
        params = [like_term, like_term, digit_like_term, like_term]

        if is_admin_like_role(role):
            cursor.execute(
                f"""
                SELECT
                    c.id,
                    c.nome,
                    c.cpf,
                    c.numero_beneficio,
                    c.vendedor_id,
                    COALESCE(v.nome, '-') AS vendedor_nome
                FROM clientes c
                LEFT JOIN usuarios v ON v.id = c.vendedor_id
                WHERE {' AND '.join(base_where)}
                ORDER BY c.nome ASC
                LIMIT %s
                """,
                tuple([*params, limit]),
            )
        elif role == ROLE_VENDOR:
            cursor.execute(
                f"""
                SELECT
                    c.id,
                    c.nome,
                    c.cpf,
                    c.numero_beneficio,
                    c.vendedor_id,
                    COALESCE(v.nome, '-') AS vendedor_nome
                FROM clientes c
                LEFT JOIN usuarios v ON v.id = c.vendedor_id
                WHERE {' AND '.join(base_where)}
                  AND c.vendedor_id = %s
                ORDER BY c.nome ASC
                LIMIT %s
                """,
                tuple([*params, user_id, limit]),
            )
        elif is_digitador_role(role):
            product_conditions = []
            product_params = []
            apply_role_product_scope(role, product_conditions, product_params, "o.produto")
            product_clause = (
                f" AND {' AND '.join(product_conditions)}" if product_conditions else ""
            )

            cursor.execute(
                f"""
                SELECT DISTINCT
                    c.id,
                    c.nome,
                    c.cpf,
                    c.numero_beneficio,
                    c.vendedor_id,
                    COALESCE(v.nome, '-') AS vendedor_nome
                FROM clientes c
                JOIN operacoes o ON o.cliente_id = c.id
                LEFT JOIN usuarios v ON v.id = c.vendedor_id
                WHERE {' AND '.join(base_where)}
                  {product_clause}
                ORDER BY c.nome ASC
                LIMIT %s
                """,
                tuple([*params, *product_params, limit]),
            )
        else:
            return jsonify({"query": query, "clients": []}), 200

        clients = cursor.fetchall()
        return jsonify({"query": query, "clients": clients}), 200
    finally:
        cursor.close()
        db.close()



# ======================================================
# Ã°Å¸â€œÆ’ LISTAR CONTRATOS DE CLIENTES
# ======================================================

@clients_bp.route("/clients/<int:client_id>/operations", methods=["GET"])
@jwt_required()
def list_operations(client_id):

    if not can_access_client(client_id):
        return jsonify({"error": "Acesso nÃƒÂ£o autorizado"}), 403

    db = get_db()
    cursor = db.cursor(dictionary=True)
    ensure_operations_extra_columns(cursor, db)

    cursor.execute(
        """
        SELECT
            o.*,
            c.vendedor_id,
            COALESCE(v.nome, '-') AS vendedor_nome,
            COALESCE(d.nome, '-') AS digitador_nome
        FROM operacoes o
        JOIN clientes c ON c.id = o.cliente_id
        LEFT JOIN usuarios v ON v.id = c.vendedor_id
        LEFT JOIN usuarios d ON d.id = o.digitador_id
        WHERE o.cliente_id = %s
        ORDER BY o.criado_em DESC
        """,
        (client_id,),
    )

    operations = [
        hydrate_operation_payload(operation)
        for operation in cursor.fetchall()
    ]

    cursor.close()
    db.close()

    return jsonify(operations), 200



# ======================================================
# FICHA DA OPERACAO
# ======================================================
@clients_bp.route("/operations/<int:operation_id>/dossier", methods=["GET"])
@jwt_required()
def get_operation_dossier(operation_id):
    role = normalize_role(current_user_role())
    user_id = current_user_id()

    if role not in OPERATION_VIEW_ALLOWED_ROLES:
        return jsonify({"error": "Acesso nao autorizado"}), 403

    db = get_db()
    cursor = db.cursor(dictionary=True)
    ensure_operations_extra_columns(cursor, db)

    cursor.execute(
        """
        SELECT
            o.*,
            c.id AS cliente_id,
            c.data_nascimento AS cliente_data_nascimento,
            c.rg_data_emissao AS cliente_rg_data_emissao,
            c.analfabeto AS cliente_analfabeto,
            c.vendedor_id,
            COALESCE(u.nome, '-') AS vendedor_nome,
            COALESCE(d.nome, '-') AS digitador_nome
        FROM operacoes o
        JOIN clientes c ON c.id = o.cliente_id
        LEFT JOIN usuarios u ON u.id = c.vendedor_id
        LEFT JOIN usuarios d ON d.id = o.digitador_id
        WHERE o.id = %s
        LIMIT 1
        """,
        (operation_id,),
    )
    operation = cursor.fetchone()

    cursor.close()
    db.close()

    if not operation:
        return jsonify({"error": "Operacao nao encontrada"}), 404

    if not role_can_access_operation(role, user_id, operation):
        return jsonify({"error": "Acesso nao autorizado"}), 403

    operation = hydrate_operation_payload(operation)
    ficha = operation.get("ficha_portabilidade")
    if isinstance(ficha, dict):
        client_birth_date = normalize_date_field(operation.get("cliente_data_nascimento"))
        if client_birth_date:
            ficha["data_nascimento"] = client_birth_date

        client_rg_issue_date = normalize_date_field(operation.get("cliente_rg_data_emissao"))
        if client_rg_issue_date:
            ficha["data_emissao_rg"] = client_rg_issue_date
            ficha["data_emissao"] = client_rg_issue_date
        if to_int(operation.get("cliente_analfabeto")):
            ficha["analfabeto"] = "Sim"

    documents = list_client_documents_metadata(operation.get("cliente_id"))

    return jsonify({"operation": operation, "documents": documents}), 200


# ======================================================
# COMENTARIOS DA OPERACAO
# ======================================================
@clients_bp.route("/operations/<int:operation_id>/comments", methods=["GET"])
@jwt_required()
def list_operation_comments(operation_id):
    role = normalize_role(current_user_role())
    user_id = current_user_id()

    if role not in OPERATION_VIEW_ALLOWED_ROLES:
        return jsonify({"error": "Acesso nao autorizado"}), 403

    db = get_db()
    cursor = db.cursor(dictionary=True)
    ensure_operation_comments_table(cursor, db)

    cursor.execute(
        """
        SELECT
            o.id,
            o.produto,
            c.vendedor_id
        FROM operacoes o
        JOIN clientes c ON c.id = o.cliente_id
        WHERE o.id = %s
        """,
        (operation_id,),
    )
    operation = cursor.fetchone()

    if not operation:
        cursor.close()
        db.close()
        return jsonify({"error": "Operacao nao encontrada"}), 404

    if not role_can_access_operation(role, user_id, operation):
        cursor.close()
        db.close()
        return jsonify({"error": "Acesso nao autorizado"}), 403

    cursor.execute(
        """
        SELECT
            oc.id,
            oc.operation_id,
            oc.author_id,
            COALESCE(u.nome, 'Usuario') AS author_name,
            COALESCE(u.role, '') AS author_role,
            oc.message,
            oc.created_at
        FROM operation_comments oc
        LEFT JOIN usuarios u ON u.id = oc.author_id
        WHERE oc.operation_id = %s
        ORDER BY oc.created_at ASC, oc.id ASC
        """,
        (operation_id,),
    )
    comments = cursor.fetchall()

    cursor.close()
    db.close()
    return jsonify(comments), 200


@clients_bp.route("/operations/<int:operation_id>/comments", methods=["POST"])
@jwt_required()
def create_operation_comment(operation_id):
    role = normalize_role(current_user_role())
    user_id = current_user_id()

    if role not in OPERATION_VIEW_ALLOWED_ROLES:
        return jsonify({"error": "Acesso nao autorizado"}), 403

    data = request.get_json() or {}
    message = str(data.get("message") or "").strip()

    if not message:
        return jsonify({"error": "Mensagem obrigatoria"}), 400

    if len(message) > 2000:
        return jsonify({"error": "Mensagem muito longa"}), 400

    db = get_db()
    cursor = db.cursor(dictionary=True)
    ensure_operation_comments_table(cursor, db)
    ensure_operation_notifications_table(cursor, db)

    cursor.execute(
        """
        SELECT
            o.id,
            o.status,
            o.produto,
            o.digitador_id,
            COALESCE(c.nome, 'Cliente') AS cliente_nome,
            c.vendedor_id
        FROM operacoes o
        JOIN clientes c ON c.id = o.cliente_id
        WHERE o.id = %s
        """,
        (operation_id,),
    )
    operation = cursor.fetchone()

    if not operation:
        cursor.close()
        db.close()
        return jsonify({"error": "Operacao nao encontrada"}), 404

    if not role_can_access_operation(role, user_id, operation):
        cursor.close()
        db.close()
        return jsonify({"error": "Acesso nao autorizado"}), 403

    cursor.execute(
        """
        INSERT INTO operation_comments (operation_id, author_id, message)
        VALUES (%s, %s, %s)
        """,
        (operation_id, user_id, message),
    )
    comment_id = cursor.lastrowid

    author_name = get_user_display_name(cursor, user_id) or "Usuario"
    notify_operation_comment(
        cursor,
        operation_id,
        operation,
        author_id=user_id,
        author_name=author_name,
        comment_message=message,
    )
    db.commit()

    cursor.execute(
        """
        SELECT
            oc.id,
            oc.operation_id,
            oc.author_id,
            COALESCE(u.nome, 'Usuario') AS author_name,
            COALESCE(u.role, '') AS author_role,
            oc.message,
            oc.created_at
        FROM operation_comments oc
        LEFT JOIN usuarios u ON u.id = oc.author_id
        WHERE oc.id = %s
        LIMIT 1
        """,
        (comment_id,),
    )
    comment = cursor.fetchone()

    cursor.close()
    db.close()
    return jsonify({"message": "Comentario enviado", "comment": comment}), 201


# ======================================================
# HISTORICO DE STATUS DA OPERACAO
# ======================================================
@clients_bp.route("/operations/<int:operation_id>/status-history", methods=["GET"])
@jwt_required()
def get_operation_status_history(operation_id):
    role = normalize_role(current_user_role())
    user_id = current_user_id()

    if role not in OPERATION_VIEW_ALLOWED_ROLES:
        return jsonify({"error": "Acesso nao autorizado"}), 403

    db = get_db()
    cursor = db.cursor(dictionary=True)
    ensure_operation_status_history_table(cursor, db)

    cursor.execute(
        """
        SELECT
            o.id,
            o.status,
            o.produto,
            o.criado_em,
            c.vendedor_id
        FROM operacoes o
        JOIN clientes c ON c.id = o.cliente_id
        WHERE o.id = %s
        LIMIT 1
        """,
        (operation_id,),
    )
    operation = cursor.fetchone()

    if not operation:
        cursor.close()
        db.close()
        return jsonify({"error": "Operacao nao encontrada"}), 404

    if not role_can_access_operation(role, user_id, operation):
        cursor.close()
        db.close()
        return jsonify({"error": "Acesso nao autorizado"}), 403

    cursor.execute(
        """
        SELECT
            osh.id,
            osh.operation_id,
            osh.previous_status,
            osh.next_status,
            osh.changed_by,
            COALESCE(u.nome, '-') AS changed_by_name,
            COALESCE(osh.changed_by_role, '') AS changed_by_role,
            osh.note,
            osh.created_at
        FROM operation_status_history osh
        LEFT JOIN usuarios u ON u.id = osh.changed_by
        WHERE osh.operation_id = %s
        ORDER BY osh.created_at ASC, osh.id ASC
        """,
        (operation_id,),
    )
    history = cursor.fetchall()

    if not history:
        history = [
            {
                "id": 0,
                "operation_id": operation_id,
                "previous_status": None,
                "next_status": normalize_operation_status(operation.get("status")),
                "changed_by": None,
                "changed_by_name": "-",
                "changed_by_role": "",
                "note": "Historico iniciado a partir do estado atual",
                "created_at": operation.get("criado_em"),
            }
        ]

    for item in history:
        previous_status = item.get("previous_status")
        item["previous_status"] = (
            normalize_operation_status(previous_status) if previous_status else None
        )
        item["next_status"] = normalize_operation_status(item.get("next_status"))

    cursor.close()
    db.close()
    return jsonify(history), 200


# Ã°Å¸â€œâ€ž OBTER CLIENTE POR ID
# ======================================================
@clients_bp.route("/clients/<int:client_id>", methods=["GET"])
@jwt_required()
def get_client(client_id):
    if not can_access_client(client_id):
        return jsonify({"error": "Acesso nÃƒÂ£o autorizado"}), 403

    db = get_db()
    cursor = db.cursor(dictionary=True)
    ensure_clients_extra_columns(cursor, db)

    client = fetch_client_record(cursor, client_id)

    cursor.close()
    db.close()

    if not client:
        return jsonify({"error": "Cliente nÃƒÂ£o encontrado"}), 404

    return jsonify(client), 200


@clients_bp.route("/clients/<int:client_id>", methods=["PUT"])
@jwt_required()
def update_client(client_id):
    if not can_access_client(client_id):
        return jsonify({"error": "Acesso nao autorizado"}), 403

    data = request.get_json() or {}
    required_fields = [
        "nome",
        "cpf",
        "data_nascimento",
        "especie",
        "uf_beneficio",
        "numero_beneficio",
        "salario",
        "nome_mae",
        "rg_numero",
        "rg_orgao_exp",
        "rg_uf",
        "rg_data_emissao",
        "naturalidade",
        "telefone",
        "cep",
        "rua",
        "numero",
        "bairro",
    ]

    missing_fields = []
    for field in required_fields:
        value = data.get(field)
        if value is None or str(value).strip() == "":
            missing_fields.append(field)

    if missing_fields:
        return jsonify(
            {
                "error": "Campos obrigatorios faltando",
                "fields": missing_fields,
            }
        ), 400

    try:
        salario = parse_flexible_decimal(data.get("salario"))
    except (TypeError, ValueError):
        return jsonify({"error": "salario invalido"}), 400

    cpf = only_digits(data.get("cpf"))
    if len(cpf) != 11:
        return jsonify({"error": "cpf invalido. Informe 11 digitos"}), 400

    cep = only_digits(data.get("cep"))
    if len(cep) != 8:
        return jsonify({"error": "cep invalido. Informe 8 digitos"}), 400

    uf_beneficio = str(data.get("uf_beneficio") or "").strip().upper()
    if len(uf_beneficio) != 2:
        return jsonify({"error": "uf_beneficio invalida. Use 2 letras"}), 400

    rg_uf = str(data.get("rg_uf") or "").strip().upper()
    if len(rg_uf) != 2:
        return jsonify({"error": "rg_uf invalida. Use 2 letras"}), 400

    try:
        data_nascimento = normalize_date_text(data.get("data_nascimento"))
        rg_data_emissao = normalize_date_text(data.get("rg_data_emissao"))
    except ValueError:
        return jsonify({"error": "Data invalida. Use DD/MM/AAAA ou AAAA-MM-DD"}), 400

    nome = normalize_text(data.get("nome"))
    especie = normalize_text(data.get("especie"))
    numero_beneficio = normalize_text(data.get("numero_beneficio"))
    nome_mae = normalize_text(data.get("nome_mae"))
    rg_numero = normalize_text(data.get("rg_numero"))
    rg_orgao_exp = normalize_text(data.get("rg_orgao_exp"))
    naturalidade = normalize_text(data.get("naturalidade"))
    telefone = only_digits(data.get("telefone"))
    try:
        email = normalize_optional_email(data.get("email"))
    except ValueError:
        return jsonify({"error": "email invalido"}), 400
    analfabeto = 1 if normalize_optional_boolean(data.get("analfabeto")) else 0
    rua = normalize_text(data.get("rua"))
    numero = normalize_text(data.get("numero"))
    bairro = normalize_text(data.get("bairro"))

    if len(telefone) < 10:
        return jsonify({"error": "telefone invalido. Informe DDD e numero"}), 400

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        ensure_clients_extra_columns(cursor, db)
        existing_client = fetch_client_record(cursor, client_id)
        if not existing_client:
            return jsonify({"error": "Cliente nao encontrado"}), 404

        cursor.execute(
            """
            SELECT
                COLUMN_NAME,
                CHARACTER_MAXIMUM_LENGTH
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'clientes'
            """
        )
        column_meta = {
            row["COLUMN_NAME"]: row.get("CHARACTER_MAXIMUM_LENGTH")
            for row in cursor.fetchall()
        }

        base_columns = [
            "nome",
            "cpf",
            "data_nascimento",
            "especie",
            "uf_beneficio",
            "numero_beneficio",
            "salario",
            "nome_mae",
            "rg_numero",
            "rg_orgao_exp",
            "rg_uf",
            "rg_data_emissao",
            "naturalidade",
            "telefone",
            "email",
            "analfabeto",
            "cep",
        ]
        missing_base_columns = [
            column_name for column_name in base_columns if column_name not in column_meta
        ]
        if missing_base_columns:
            return jsonify(
                {
                    "error": "Estrutura da tabela clientes desatualizada",
                    "fields": missing_base_columns,
                }
            ), 500

        use_split_address = all(
            column_name in column_meta for column_name in ("rua", "numero", "bairro")
        )
        use_legacy_address = all(
            column_name in column_meta for column_name in ("endereco", "bairro")
        )

        if use_split_address:
            address_columns = ["rua", "numero", "bairro"]
            address_values = [rua, numero, bairro]
        elif use_legacy_address:
            address_columns = ["endereco", "bairro"]
            composed_address = ", ".join(part for part in (rua, numero) if part).strip()
            address_values = [composed_address, bairro]
        else:
            return jsonify(
                {
                    "error": "Estrutura da tabela clientes invalida para endereco",
                }
            ), 500

        string_values = {
            "nome": nome,
            "cpf": cpf,
            "especie": especie,
            "uf_beneficio": uf_beneficio,
            "numero_beneficio": numero_beneficio,
            "nome_mae": nome_mae,
            "rg_numero": rg_numero,
            "rg_orgao_exp": rg_orgao_exp,
            "rg_uf": rg_uf,
            "naturalidade": naturalidade,
            "telefone": telefone,
            "email": email,
            "cep": cep,
            **dict(zip(address_columns, address_values)),
        }

        for column_name, value in string_values.items():
            max_length = column_meta.get(column_name)
            if max_length and len(str(value)) > int(max_length):
                return jsonify(
                    {
                        "error": f"{column_name} excede o limite de {int(max_length)} caracteres",
                    }
                ), 400

        update_columns = base_columns + address_columns
        update_values = {
            "nome": nome,
            "cpf": cpf,
            "data_nascimento": data_nascimento,
            "especie": especie,
            "uf_beneficio": uf_beneficio,
            "numero_beneficio": numero_beneficio,
            "salario": salario,
            "nome_mae": nome_mae,
            "rg_numero": rg_numero,
            "rg_orgao_exp": rg_orgao_exp,
            "rg_uf": rg_uf,
            "rg_data_emissao": rg_data_emissao,
            "naturalidade": naturalidade,
            "telefone": telefone,
            "email": email or None,
            "analfabeto": analfabeto,
            "cep": cep,
            **dict(zip(address_columns, address_values)),
        }
        update_sql = ", ".join([f"{column_name} = %s" for column_name in update_columns])
        update_params = [update_values[column_name] for column_name in update_columns]
        update_params.append(client_id)

        cursor.execute(
            f"""
            UPDATE clientes
            SET {update_sql}
            WHERE id = %s
            """,
            tuple(update_params),
        )
        db.commit()

        client = fetch_client_record(cursor, client_id)
        return jsonify(
            {
                "message": "Cliente atualizado com sucesso",
                "client": client,
            }
        ), 200
    except Exception as exc:
        db.rollback()
        message = str(exc)

        if "Duplicate entry" in message and "cpf" in message.lower():
            return jsonify({"error": "CPF ja cadastrado"}), 409

        if "Incorrect date value" in message:
            return jsonify({"error": "Data invalida"}), 400

        data_too_long_match = re.search(
            r"Data too long for column '([^']+)'",
            message,
            flags=re.IGNORECASE,
        )
        if data_too_long_match:
            field_name = data_too_long_match.group(1)
            return jsonify({"error": f"{field_name} excede o limite permitido"}), 400

        return jsonify({"error": "Erro ao atualizar cliente"}), 500
    finally:
        cursor.close()
        db.close()


# ======================================================
# Ã°Å¸â€œÂ¤ UPLOAD DE DOCUMENTOS
# ======================================================
@clients_bp.route("/operations/<int:operation_id>", methods=["DELETE"])
@jwt_required()
def delete_operation(operation_id):
    actor_id = current_user_id()
    role = normalize_role(current_user_role())
    if role != ROLE_GLOBAL:
        return jsonify({"error": "Somente GLOBAL pode excluir operacoes"}), 403

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        ensure_operation_comments_table(cursor, db)
        ensure_operation_status_history_table(cursor, db)
        ensure_operation_notifications_table(cursor, db)
        ensure_trash_bin_table(cursor, db)
        ensure_audit_logs_table(cursor, db)

        twofa_error = require_global_twofa(cursor, actor_id)
        if twofa_error:
            log_audit(
                cursor,
                actor_id=actor_id,
                actor_role=role,
                action="DELETE_OPERATION",
                target_type="OPERACAO",
                target_id=operation_id,
                success=False,
                reason="2FA invalido",
            )
            db.commit()
            return twofa_error

        cursor.execute(
            """
            SELECT *
            FROM operacoes
            WHERE id = %s
            LIMIT 1
            """,
            (operation_id,),
        )
        operation = cursor.fetchone()
        if not operation:
            log_audit(
                cursor,
                actor_id=actor_id,
                actor_role=role,
                action="DELETE_OPERATION",
                target_type="OPERACAO",
                target_id=operation_id,
                success=False,
                reason="Operacao nao encontrada",
            )
            db.commit()
            return jsonify({"error": "Operacao nao encontrada"}), 404

        cursor.execute(
            """
            SELECT *
            FROM operation_comments
            WHERE operation_id = %s
            ORDER BY id ASC
            """,
            (operation_id,),
        )
        comments = cursor.fetchall()

        cursor.execute(
            """
            SELECT *
            FROM operation_status_history
            WHERE operation_id = %s
            ORDER BY id ASC
            """,
            (operation_id,),
        )
        history = cursor.fetchall()

        cursor.execute(
            """
            SELECT *
            FROM operation_notifications
            WHERE operation_id = %s
            ORDER BY id ASC
            """,
            (operation_id,),
        )
        notifications = cursor.fetchall()

        trash_id = add_to_trash(
            cursor,
            entity_type="OPERACAO",
            entity_id=operation_id,
            payload={
                "operation": row_to_insert_dict(operation),
                "comments": [row_to_insert_dict(item) for item in comments],
                "status_history": [row_to_insert_dict(item) for item in history],
                "notifications": [row_to_insert_dict(item) for item in notifications],
            },
            deleted_by=actor_id,
            deleted_role=role,
            reason="Exclusao individual de operacao",
        )

        cursor.execute("DELETE FROM operation_comments WHERE operation_id = %s", (operation_id,))
        cursor.execute(
            "DELETE FROM operation_status_history WHERE operation_id = %s",
            (operation_id,),
        )
        cursor.execute(
            "DELETE FROM operation_notifications WHERE operation_id = %s",
            (operation_id,),
        )
        cursor.execute("DELETE FROM operacoes WHERE id = %s", (operation_id,))
        log_audit(
            cursor,
            actor_id=actor_id,
            actor_role=role,
            action="DELETE_OPERATION",
            target_type="OPERACAO",
            target_id=operation_id,
            success=True,
            metadata={"trash_id": trash_id},
        )
        db.commit()

        return jsonify(
            {
                "message": "Operacao excluida com sucesso",
                "operation": {
                    "id": to_int(operation.get("id")),
                    "cliente_id": to_int(operation.get("cliente_id")),
                    "status": normalize_operation_status(operation.get("status")),
                },
                "trash_id": to_int(trash_id),
            }
        ), 200
    except Exception:
        db.rollback()
        return jsonify({"error": "Nao foi possivel excluir a operacao"}), 500
    finally:
        cursor.close()
        db.close()


@clients_bp.route("/clients/<int:client_id>", methods=["DELETE"])
@jwt_required()
def delete_client(client_id):
    actor_id = current_user_id()
    role = normalize_role(current_user_role())
    if role != ROLE_GLOBAL:
        return jsonify({"error": "Somente GLOBAL pode excluir clientes"}), 403

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        ensure_operation_comments_table(cursor, db)
        ensure_operation_status_history_table(cursor, db)
        ensure_operation_notifications_table(cursor, db)
        ensure_trash_bin_table(cursor, db)
        ensure_audit_logs_table(cursor, db)

        twofa_error = require_global_twofa(cursor, actor_id)
        if twofa_error:
            log_audit(
                cursor,
                actor_id=actor_id,
                actor_role=role,
                action="DELETE_CLIENT",
                target_type="CLIENTE",
                target_id=client_id,
                success=False,
                reason="2FA invalido",
            )
            db.commit()
            return twofa_error

        cursor.execute(
            """
            SELECT *
            FROM clientes
            WHERE id = %s
            LIMIT 1
            """,
            (client_id,),
        )
        client = cursor.fetchone()
        if not client:
            log_audit(
                cursor,
                actor_id=actor_id,
                actor_role=role,
                action="DELETE_CLIENT",
                target_type="CLIENTE",
                target_id=client_id,
                success=False,
                reason="Cliente nao encontrado",
            )
            db.commit()
            return jsonify({"error": "Cliente nao encontrado"}), 404

        cursor.execute(
            """
            SELECT *
            FROM operacoes
            WHERE cliente_id = %s
            ORDER BY id ASC
            """,
            (client_id,),
        )
        operation_rows = cursor.fetchall()
        operation_ids = [
            to_int(item.get("id"))
            for item in operation_rows
            if to_int(item.get("id")) > 0
        ]

        operation_comments = []
        operation_history = []
        operation_notifications = []

        if operation_ids:
            placeholders = ", ".join(["%s"] * len(operation_ids))
            cursor.execute(
                f"""
                SELECT *
                FROM operation_comments
                WHERE operation_id IN ({placeholders})
                ORDER BY id ASC
                """,
                tuple(operation_ids),
            )
            operation_comments = cursor.fetchall()

            cursor.execute(
                f"""
                SELECT *
                FROM operation_status_history
                WHERE operation_id IN ({placeholders})
                ORDER BY id ASC
                """,
                tuple(operation_ids),
            )
            operation_history = cursor.fetchall()

            cursor.execute(
                f"""
                SELECT *
                FROM operation_notifications
                WHERE operation_id IN ({placeholders})
                ORDER BY id ASC
                """,
                tuple(operation_ids),
            )
            operation_notifications = cursor.fetchall()

        ensure_documents_table(cursor, db)
        sync_storage_documents_to_db(cursor, client_id, seller_id=to_int(client.get("vendedor_id")))
        documents = []
        cursor.execute(
            """
            SELECT *
            FROM documentos
            WHERE client_id = %s
            ORDER BY id ASC
            """,
            (client_id,),
        )
        documents = cursor.fetchall()

        trash_id = add_to_trash(
            cursor,
            entity_type="CLIENTE",
            entity_id=client_id,
            payload={
                "client": row_to_insert_dict(client),
                "operations": [row_to_insert_dict(item) for item in operation_rows],
                "operation_comments": [row_to_insert_dict(item) for item in operation_comments],
                "operation_status_history": [row_to_insert_dict(item) for item in operation_history],
                "operation_notifications": [
                    row_to_insert_dict(item) for item in operation_notifications
                ],
                "documents": [serialize_document_row_for_trash(item) for item in documents],
            },
            deleted_by=actor_id,
            deleted_role=role,
            reason="Exclusao individual de cliente",
        )

        if operation_ids:
            placeholders = ", ".join(["%s"] * len(operation_ids))
            cursor.execute(
                f"DELETE FROM operation_comments WHERE operation_id IN ({placeholders})",
                tuple(operation_ids),
            )
            cursor.execute(
                f"DELETE FROM operation_status_history WHERE operation_id IN ({placeholders})",
                tuple(operation_ids),
            )
            cursor.execute(
                f"DELETE FROM operation_notifications WHERE operation_id IN ({placeholders})",
                tuple(operation_ids),
            )

        cursor.execute("DELETE FROM operacoes WHERE cliente_id = %s", (client_id,))
        cursor.execute("DELETE FROM documentos WHERE client_id = %s", (client_id,))

        cursor.execute("DELETE FROM clientes WHERE id = %s", (client_id,))
        log_audit(
            cursor,
            actor_id=actor_id,
            actor_role=role,
            action="DELETE_CLIENT",
            target_type="CLIENTE",
            target_id=client_id,
            success=True,
            metadata={"trash_id": trash_id, "operations_count": len(operation_ids)},
        )
        db.commit()
        return jsonify(
            {
                "message": "Cliente excluido com sucesso",
                "client": {
                    "id": to_int(client.get("id")),
                    "nome": client.get("nome") or "",
                    "cpf": client.get("cpf") or "",
                    "vendedor_id": to_int(client.get("vendedor_id")),
                },
                "removed_operations": len(operation_ids),
                "trash_id": to_int(trash_id),
            }
        ), 200
    except Exception:
        db.rollback()
        return jsonify({"error": "Nao foi possivel excluir o cliente"}), 500
    finally:
        cursor.close()
        db.close()


@clients_bp.route("/clients/upload", methods=["POST", "OPTIONS"])
@jwt_required(optional=True)
def upload_document():
    if request.method == "OPTIONS":
        return "", 200

    client_id = request.form.get("client_id")

    if not client_id:
        return jsonify({"error": "client_id e obrigatorio"}), 400

    if not can_access_client(int(client_id)):
        return jsonify({"error": "Acesso nao autorizado"}), 403

    if not request.files:
        return jsonify({"error": "Nenhum arquivo enviado"}), 400

    db = get_db()
    cursor = db.cursor(dictionary=True)
    saved_files = {}

    try:
        ensure_documents_table(cursor, db)
        seller_id = resolve_client_seller_id(cursor, int(client_id))

        for field_name, file in request.files.items():
            if not file or not allowed_file(file.filename):
                continue

            ext = file.filename.rsplit(".", 1)[1].lower()
            filename = f"{field_name}_{uuid.uuid4().hex}.{ext}"
            original_name = normalize_document_filename(file.filename) or filename
            file_bytes = file.read()

            cursor.execute(
                """
                INSERT INTO documentos (
                    client_id,
                    seller_id,
                    document_type,
                    file_name,
                    original_name,
                    content_type,
                    file_size,
                    file_data
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    int(client_id),
                    seller_id,
                    infer_document_type(field_name=field_name, filename=filename),
                    filename,
                    original_name,
                    file.mimetype
                    or mimetypes.guess_type(original_name)[0]
                    or "application/octet-stream",
                    len(file_bytes),
                    file_bytes,
                ),
            )
            saved_files[field_name] = filename

        if not saved_files:
            db.rollback()
            return jsonify({"error": "Nenhum arquivo valido enviado"}), 400

        db.commit()
        return jsonify({
            "message": "Arquivos enviados com sucesso",
            "files": saved_files
        }), 201
    except Exception:
        db.rollback()
        return jsonify({"error": "Nao foi possivel salvar os documentos"}), 500
    finally:
        cursor.close()
        db.close()

# ======================================================
# Ã°Å¸â€œÆ’ LISTAR DOCUMENTOS
# ======================================================
@clients_bp.route("/clients/<int:client_id>/documents", methods=["GET", "OPTIONS"])
@jwt_required(optional=True)
def list_documents(client_id):
    if request.method == "OPTIONS":
        return "", 200

    if not can_access_client_documents(client_id):
        return jsonify({"error": "Acesso nao autorizado"}), 403

    documents = list_client_documents_metadata(client_id)

    return jsonify({
        "client_id": client_id,
        "documents": documents
    }), 200

# ======================================================
# Ã°Å¸â€œÂ¥ DOWNLOAD DOCUMENTO
# ======================================================
@clients_bp.route(
    "/clients/<int:client_id>/documents/<filename>",
    methods=["GET", "OPTIONS"]
)
@jwt_required(optional=True)
def download_document(client_id, filename):
    if request.method == "OPTIONS":
        return "", 200

    if not can_access_client_documents(client_id):
        return jsonify({"error": "Acesso nao autorizado"}), 403

    db = get_db()
    cursor = db.cursor(dictionary=True)
    try:
        ensure_documents_table(cursor, db)
        if sync_storage_documents_to_db(cursor, client_id) > 0:
            db.commit()

        document, safe_filename = get_client_document_record(cursor, client_id, filename)
        if document and document.get("file_data") is not None:
            return send_file(
                BytesIO(document.get("file_data")),
                as_attachment=True,
                download_name=document.get("original_name") or safe_filename,
                mimetype=document.get("content_type") or "application/octet-stream",
            )
    finally:
        cursor.close()
        db.close()

    client_folder, safe_filename = find_client_document_file(client_id, filename)
    if not client_folder:
        return jsonify({"error": "Arquivo nao encontrado"}), 404

    return send_file(
        os.path.join(client_folder, safe_filename),
        as_attachment=True,
        download_name=safe_filename,
    )

# ======================================================
# Ã°Å¸â€”â€˜Ã¯Â¸Â EXCLUIR DOCUMENTO
# ======================================================
@clients_bp.route(
    "/clients/<int:client_id>/documents/<filename>",
    methods=["DELETE", "OPTIONS"]
)
@jwt_required(optional=True)
def delete_document(client_id, filename):
    if request.method == "OPTIONS":
        return "", 200

    if not can_access_client(client_id):
        return jsonify({"error": "Acesso nao autorizado"}), 403

    db = get_db()
    cursor = db.cursor(dictionary=True)
    try:
        ensure_documents_table(cursor, db)
        _, safe_filename = get_client_document_record(cursor, client_id, filename)
        if not safe_filename:
            return jsonify({"error": "Arquivo nao encontrado"}), 404

        cursor.execute(
            """
            DELETE FROM documentos
            WHERE client_id = %s
              AND file_name = %s
            """,
            (client_id, safe_filename),
        )
        removed_from_db = cursor.rowcount > 0

        client_folder, safe_file_from_storage = find_client_document_file(client_id, safe_filename)
        removed_from_storage = False
        if client_folder and safe_file_from_storage:
            os.remove(os.path.join(client_folder, safe_file_from_storage))
            removed_from_storage = True

        if not removed_from_db and not removed_from_storage:
            db.rollback()
            return jsonify({"error": "Arquivo nao encontrado"}), 404

        db.commit()
        return jsonify({
            "message": "Documento excluido com sucesso",
            "filename": safe_filename
        }), 200
    except Exception:
        db.rollback()
        return jsonify({"error": "Nao foi possivel excluir o documento"}), 500
    finally:
        cursor.close()
        db.close()

# ======================================================
# Ã°Å¸â€œâ€ž ADMIN ATUALIZA STATUS
# ======================================================


@clients_bp.route("/operations/<int:operation_id>", methods=["PUT"])
@jwt_required()
def update_operation(operation_id):
    data = request.get_json() or {}

    if not data:
        return jsonify({"error": "Nenhum dado para atualizar"}), 400

    role = normalize_role(current_user_role())
    user_id = current_user_id()
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    db = get_db()
    cursor = db.cursor(dictionary=True)
    ensure_operations_extra_columns(cursor, db)
    ensure_operation_status_history_table(cursor, db)
    ensure_operation_notifications_table(cursor, db)

    if "ficha_portabilidade" in data:
        data["ficha_portabilidade"] = serialize_portability_form(
            data.get("ficha_portabilidade")
        )

    cursor.execute(
        """
        SELECT
            o.id,
            o.status,
            o.status_andamento,
            o.enviada_esteira_em,
            o.pendencia_motivo,
            o.produto,
            o.digitador_id,
            c.vendedor_id
        FROM operacoes o
        JOIN clientes c ON c.id = o.cliente_id
        WHERE o.id=%s
        """,
        (operation_id,),
    )
    operation = cursor.fetchone()

    if not operation:
        cursor.close()
        db.close()
        return jsonify({"error": "Operacao nao encontrada"}), 404

    current_status = normalize_operation_status(operation.get("status"))
    original_status = current_status
    next_status_for_history = current_status
    original_progress_status = normalize_operation_progress_status(
        operation.get("status_andamento")
    )
    next_progress_status_for_notification = original_progress_status
    history_note = None
    sent_to_pipeline = operation.get("enviada_esteira_em") is not None
    allowed_fields = set()

    if role == ROLE_VENDOR:
        if operation.get("vendedor_id") != user_id:
            cursor.close()
            db.close()
            return jsonify({"error": "Voce nao pode editar essa operacao"}), 403

        if current_status == "PRONTA_DIGITAR":
            if sent_to_pipeline:
                cursor.close()
                db.close()
                return jsonify({
                    "error": "Operacao ja enviada para esteira. Aguarde retorno."
                }), 400

            if "status" in data:
                next_status = normalize_operation_status(data.get("status"))
                if next_status != "PRONTA_DIGITAR":
                    cursor.close()
                    db.close()
                    return jsonify({
                        "error": "Para enviar para esteira, use o botao de envio"
                    }), 400
                data["status"] = "PRONTA_DIGITAR"
                next_status_for_history = "PRONTA_DIGITAR"

            allowed_fields = PENDING_OPERATION_FIELDS

        elif current_status == "DEVOLVIDA_VENDEDOR":
            if "status" in data:
                next_status = normalize_operation_status(data.get("status"))
                if next_status != "DEVOLVIDA_VENDEDOR":
                    cursor.close()
                    db.close()
                    return jsonify({
                        "error": "Edite os dados e use o botao de reenviar para esteira"
                    }), 400
                data["status"] = next_status
                next_status_for_history = next_status

            allowed_fields = PENDING_OPERATION_FIELDS

        else:
            cursor.close()
            db.close()
            return jsonify({
                "error": "Sem permissao para editar operacao neste status"
            }), 403

    elif is_admin_like_role(role) or is_digitador_role(role):
        if is_digitador_role(role) and not role_can_access_operation(role, user_id, operation):
            cursor.close()
            db.close()
            return jsonify({"error": "Acesso nao autorizado para este produto"}), 403

        if is_digitador_role(role) and "produto" in data:
            next_product = normalize_product_name(data.get("produto"))
            if (
                next_product
                and next_product not in allowed_products_for_role(role)
            ):
                cursor.close()
                db.close()
                return jsonify({"error": "Produto nao permitido para este perfil"}), 403
            data["produto"] = next_product

        if current_status in FINAL_OPERATION_STATUSES:
            cursor.close()
            db.close()
            return jsonify({
                "error": "Operacao finalizada. Nao e possivel editar."
            }), 400

        if current_status == "PRONTA_DIGITAR" and not sent_to_pipeline:
            if "status" in data:
                next_status = normalize_operation_status(data.get("status"))
                if next_status != "PRONTA_DIGITAR":
                    cursor.close()
                    db.close()
                    return jsonify({
                        "error": "Envie para esteira antes de alterar o fluxo"
                    }), 400
            allowed_fields = PENDING_OPERATION_FIELDS
        else:
            allowed_fields = PIPELINE_OPERATION_FIELDS

            if "status" in data:
                next_status = normalize_operation_status(data.get("status"))
                if next_status not in VALID_PIPELINE_STATUS_UPDATES:
                    cursor.close()
                    db.close()
                    return jsonify({"error": "Status invalido para a esteira"}), 400

                allowed_transitions = {
                    "PRONTA_DIGITAR": {
                        "PRONTA_DIGITAR",
                        "EM_DIGITACAO",
                        "PENDENCIA",
                        "DEVOLVIDA_VENDEDOR",
                        "REPROVADO",
                    },
                    "EM_DIGITACAO": {
                        "EM_DIGITACAO",
                        "AGUARDANDO_FORMALIZACAO",
                        "DEVOLVIDA_VENDEDOR",
                        "REPROVADO",
                    },
                    "AGUARDANDO_FORMALIZACAO": {"AGUARDANDO_FORMALIZACAO", "ANALISE_BANCO", "DEVOLVIDA_VENDEDOR", "REPROVADO"},
                    "ANALISE_BANCO": {"ANALISE_BANCO", "PENDENCIA", "DEVOLVIDA_VENDEDOR", "APROVADO", "REPROVADO"},
                    "PENDENCIA": {"PENDENCIA", "ANALISE_BANCO", "DEVOLVIDA_VENDEDOR"},
                    "DEVOLVIDA_VENDEDOR": {"DEVOLVIDA_VENDEDOR", "ANALISE_BANCO"},
                }

                allowed_next = allowed_transitions.get(current_status, {current_status})
                if next_status not in allowed_next:
                    cursor.close()
                    db.close()
                    return jsonify({
                        "error": "Transicao de status invalida para o fluxo atual"
                    }), 400

                if (
                    current_status == "PRONTA_DIGITAR"
                    and next_status == "EM_DIGITACAO"
                    and not sent_to_pipeline
                ):
                    cursor.close()
                    db.close()
                    return jsonify({
                        "error": "Envie para esteira antes de iniciar digitacao"
                    }), 400

                data["status"] = next_status
                next_status_for_history = next_status

                if next_status == "EM_DIGITACAO":
                    data["digitador_id"] = user_id
                    cursor.execute(
                        """
                        SELECT COALESCE(nome, 'Digitador') AS nome
                        FROM usuarios
                        WHERE id = %s
                        LIMIT 1
                        """,
                        (user_id,),
                    )
                    actor = cursor.fetchone() or {}
                    actor_name = str(actor.get("nome") or "").strip()
                    history_note = (
                        f"Digitacao iniciada por {actor_name}"
                        if actor_name
                        else "Digitacao iniciada"
                    )

                if next_status == "AGUARDANDO_FORMALIZACAO":
                    link = str(data.get("link_formalizacao") or "").strip()
                    if not link:
                        cursor.close()
                        db.close()
                        return jsonify({
                            "error": "Informe o link_formalizacao para devolver ao vendedor"
                        }), 400

                    proposal_number = str(data.get("numero_proposta") or "").strip()
                    if not proposal_number:
                        cursor.close()
                        db.close()
                        return jsonify({
                            "error": "Informe o numero_proposta para devolver ao vendedor"
                        }), 400

                    try:
                        valor_liberado = float(str(data.get("valor_liberado") or "").replace(",", "."))
                    except (TypeError, ValueError):
                        cursor.close()
                        db.close()
                        return jsonify({"error": "valor_liberado invalido"}), 400

                    try:
                        parcela_liberada = float(str(data.get("parcela_liberada") or "").replace(",", "."))
                    except (TypeError, ValueError):
                        cursor.close()
                        db.close()
                        return jsonify({"error": "parcela_liberada invalida"}), 400

                    if valor_liberado <= 0:
                        cursor.close()
                        db.close()
                        return jsonify({"error": "valor_liberado deve ser maior que zero"}), 400

                    if parcela_liberada <= 0:
                        cursor.close()
                        db.close()
                        return jsonify({"error": "parcela_liberada deve ser maior que zero"}), 400

                    data["link_formalizacao"] = link
                    data["numero_proposta"] = proposal_number
                    data["valor_liberado"] = round(valor_liberado, 2)
                    data["parcela_liberada"] = round(parcela_liberada, 2)
                    data["devolvida_em"] = now_str

                if (
                    current_status == "AGUARDANDO_FORMALIZACAO"
                    and next_status == "ANALISE_BANCO"
                    and "formalizado_em" not in data
                ):
                    data["formalizado_em"] = now_str

                if next_status == "PENDENCIA":
                    reason = str(data.get("pendencia_motivo") or "").strip()
                    if not reason:
                        cursor.close()
                        db.close()
                        return jsonify({
                            "error": "Informe o motivo da pendencia para o vendedor"
                        }), 400
                    data["pendencia_motivo"] = reason
                    data["pendencia_aberta_em"] = now_str

                if next_status == "DEVOLVIDA_VENDEDOR":
                    reason = str(data.get("pendencia_motivo") or "").strip()
                    if not reason:
                        reason = str(operation.get("pendencia_motivo") or "").strip()
                    if not reason:
                        cursor.close()
                        db.close()
                        return jsonify({
                            "error": "Informe o motivo para devolver ao vendedor"
                        }), 400
                    data["pendencia_motivo"] = reason
                    data["devolvida_em"] = now_str

                if next_status == "APROVADO" and "data_pagamento" not in data:
                    data["data_pagamento"] = now_str

                if next_status == "REPROVADO":
                    rejected_reason = str(data.get("motivo_reprovacao") or "").strip()
                    if not rejected_reason:
                        cursor.close()
                        db.close()
                        return jsonify({"error": "Informe o motivo da reprovaÃƒÂ§ÃƒÂ£o"}), 400
                    data["motivo_reprovacao"] = rejected_reason

            if "link_formalizacao" in data and data.get("link_formalizacao") is not None:
                data["link_formalizacao"] = str(data.get("link_formalizacao") or "").strip()

            if "numero_proposta" in data and data.get("numero_proposta") is not None:
                data["numero_proposta"] = str(data.get("numero_proposta") or "").strip()

            if "pendencia_tipo" in data and data.get("pendencia_tipo") is not None:
                data["pendencia_tipo"] = str(data.get("pendencia_tipo") or "").strip().upper()

            if "pendencia_motivo" in data and data.get("pendencia_motivo") is not None:
                data["pendencia_motivo"] = str(data.get("pendencia_motivo") or "").strip()

            if "motivo_reprovacao" in data and data.get("motivo_reprovacao") is not None:
                data["motivo_reprovacao"] = str(data.get("motivo_reprovacao") or "").strip()

            if "promotora" in data:
                promotora = str(data.get("promotora") or "").strip().upper()
                if promotora and promotora not in PROMOTORA_OPTIONS:
                    cursor.close()
                    db.close()
                    return jsonify({"error": "Promotora invalida"}), 400
                data["promotora"] = promotora or None

            if "status_andamento" in data:
                status_andamento = normalize_operation_progress_status(
                    data.get("status_andamento")
                )
                if (
                    status_andamento
                    and status_andamento not in OPERATION_PROGRESS_OPTIONS
                ):
                    cursor.close()
                    db.close()
                    return jsonify({"error": "Status de andamento invalido"}), 400
                data["status_andamento"] = status_andamento or None
                next_progress_status_for_notification = status_andamento

    else:
        cursor.close()
        db.close()
        return jsonify({"error": "Usuario sem permissao"}), 403

    updates, params = build_operation_update(data, allowed_fields)

    if not updates:
        cursor.close()
        db.close()
        return jsonify({"error": "Nenhum campo permitido para atualizacao"}), 400

    params.append(operation_id)
    cursor.execute(
        f"UPDATE operacoes SET {', '.join(updates)} WHERE id=%s",
        tuple(params),
    )

    if next_status_for_history != original_status:
        register_operation_status_history(
            cursor,
            operation_id,
            original_status,
            next_status_for_history,
            changed_by=user_id,
            changed_by_role=role,
            note=history_note,
        )
        notify_vendor_status_change(
            cursor,
            operation_id,
            original_status,
            next_status_for_history,
            changed_by=user_id,
        )

    if next_progress_status_for_notification != original_progress_status:
        notify_vendor_progress_change(
            cursor,
            operation_id,
            original_progress_status,
            next_progress_status_for_notification,
            changed_by=user_id,
        )

    db.commit()

    cursor.execute("SELECT * FROM operacoes WHERE id=%s", (operation_id,))
    updated_operation = hydrate_operation_payload(cursor.fetchone())

    if updated_operation:
        updated_operation["status"] = normalize_operation_status(
            updated_operation.get("status")
        )

    cursor.close()
    db.close()
    return jsonify({
        "message": "Operacao atualizada",
        "operation": updated_operation,
    }), 200



# ======================================================
# Ã°Å¸â€œâ€ž ENVIAR OPERAÃƒâ€¡ÃƒÆ’O PARA ESTEIRA
# ======================================================

@clients_bp.route("/operations/<int:operation_id>/send", methods=["POST"])
@jwt_required()
def send_operation_to_pipeline(operation_id):
    conn = None
    cursor = None

    try:
        role = normalize_role(current_user_role())
        user_id = current_user_id()

        if role not in {ROLE_ADMIN, ROLE_GLOBAL, ROLE_VENDOR}:
            return jsonify({"error": "Usuario sem permissao"}), 403

        conn = get_db()
        cursor = conn.cursor(dictionary=True)
        ensure_operations_extra_columns(cursor, conn)
        ensure_operation_status_history_table(cursor, conn)
        ensure_operation_notifications_table(cursor, conn)

        cursor.execute(
            """
            SELECT
                o.id,
                o.status,
                o.produto,
                o.digitador_id,
                o.enviada_esteira_em,
                COALESCE(c.nome, 'Cliente') AS cliente_nome,
                c.vendedor_id
            FROM operacoes o
            JOIN clientes c ON c.id = o.cliente_id
            WHERE o.id=%s
            """,
            (operation_id,),
        )
        operation = cursor.fetchone()

        if not operation:
            return jsonify({"error": "Operacao nao encontrada"}), 404

        if role == ROLE_VENDOR and operation.get("vendedor_id") != user_id:
            return jsonify({"error": "Voce nao pode enviar essa operacao"}), 403

        current_status = normalize_operation_status(operation.get("status"))
        sent_to_pipeline = operation.get("enviada_esteira_em") is not None
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        updates = []
        params = []
        next_status = current_status

        if current_status in FINAL_OPERATION_STATUSES:
            return jsonify({
                "error": "Operacao finalizada nao pode voltar para esteira"
            }), 400

        if current_status == "PRONTA_DIGITAR":
            if sent_to_pipeline:
                return jsonify({"error": "Operacao ja esta na esteira"}), 400

            updates.append("status=%s")
            params.append("PRONTA_DIGITAR")
            updates.append("enviada_esteira_em=%s")
            params.append(now_str)

        elif current_status in {"AGUARDANDO_FORMALIZACAO", "DEVOLVIDA_VENDEDOR"}:
            next_status = "ANALISE_BANCO"
            updates.extend([
                "status=%s",
                "formalizado_em=COALESCE(formalizado_em, %s)",
                "devolvida_em=NULL",
            ])
            params.extend([next_status, now_str])

        elif current_status in PIPELINE_ACTIVE_STATUSES:
            return jsonify({"error": "Operacao ja esta na esteira"}), 400

        else:
            return jsonify({"error": "Status da operacao invalido para envio"}), 400

        if not updates:
            return jsonify({"error": "Nada para atualizar"}), 400

        params.append(operation_id)
        cursor.execute(
            f"UPDATE operacoes SET {', '.join(updates)} WHERE id=%s",
            tuple(params),
        )

        history_note = (
            "Enviada para esteira"
            if current_status == "PRONTA_DIGITAR"
            else "Reenviada para analise do banco"
        )
        register_operation_status_history(
            cursor,
            operation_id,
            current_status,
            next_status,
            changed_by=user_id,
            changed_by_role=role,
            note=history_note,
        )
        notify_vendor_status_change(
            cursor,
            operation_id,
            current_status,
            next_status,
            changed_by=user_id,
        )

        if current_status == "PRONTA_DIGITAR":
            notify_operation_arrived_pipeline(
                cursor,
                operation_id,
                operation,
                changed_by=user_id,
            )

        conn.commit()

        return jsonify({
            "message": "Operacao enviada para esteira",
            "status": next_status,
        }), 200

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500
    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()
# ======================================================
# Ã°Å¸â€œâ€ž ADMIN FASE COMERCIAL
# ======================================================


@clients_bp.route("/clients/<int:client_id>/fase", methods=["PUT"])
@jwt_required()
def update_client_fase(client_id):

    if not is_admin():
        return jsonify({
            "error": "Somente ADMIN/GLOBAL pode alterar fase"
        }), 403

    data = request.get_json() or {}
    nova_fase = data.get("fase")

    db = get_db()
    cursor = db.cursor()

    cursor.execute("""
        UPDATE clientes
        SET fase=%s
        WHERE id=%s
    """, (nova_fase, client_id))

    db.commit()
    cursor.close()
    db.close()

    return jsonify({"message": "Fase atualizada com sucesso"}), 200


# ======================================================
# Ã°Å¸â€œâ€ž ADMIN - LISTAR ESTEIRA
# ======================================================

@clients_bp.route("/operations/pipeline", methods=["GET"])
@jwt_required()
def get_pipeline():
    role = normalize_role(current_user_role())
    user_id = current_user_id()

    if role not in PIPELINE_ALLOWED_ROLES:
        return jsonify({"error": "Acesso restrito"}), 403

    db = get_db()
    cursor = db.cursor(dictionary=True)
    ensure_operations_extra_columns(cursor, db)

    status_placeholders = ", ".join(["%s"] * len(PIPELINE_ACTIVE_STATUSES_WITH_LEGACY))
    conditions = [
        f"o.status IN ({status_placeholders})",
        """(
            o.status NOT IN ('PRONTA_DIGITAR', 'PENDENTE')
            OR o.enviada_esteira_em IS NOT NULL
        )""",
    ]
    params = list(PIPELINE_ACTIVE_STATUSES_WITH_LEGACY)
    apply_role_product_scope(role, conditions, params, "o.produto")

    if is_digitador_role(role):
        ready_placeholders = ", ".join(
            ["%s"] * len(PIPELINE_READY_VISIBLE_STATUSES_WITH_LEGACY)
        )
        conditions.append(
            f"""(
                UPPER(o.status) IN ({ready_placeholders})
                OR o.digitador_id = %s
            )"""
        )
        params.extend(PIPELINE_READY_VISIBLE_STATUSES_WITH_LEGACY)
        params.append(user_id)

    where_clause = " AND ".join(conditions)

    cursor.execute(f"""
        SELECT 
            o.id,
            o.produto,
            o.banco_digitacao,
            o.margem,
            o.valor_solicitado,
            o.parcela_solicitada,
            o.valor_liberado,
            o.parcela_liberada,
            o.promotora,
            o.numero_proposta,
            o.status_andamento,
            o.enviada_esteira_em,
            o.link_formalizacao,
            o.devolvida_em,
            o.formalizado_em,
            o.pendencia_tipo,
            o.pendencia_motivo,
            o.pendencia_aberta_em,
            o.pendencia_resposta_vendedor,
            o.pendencia_respondida_em,
            o.motivo_reprovacao,
            o.ficha_portabilidade,
            o.prazo,
            o.status,
            o.digitador_id,
            o.criado_em,
            c.id as cliente_id,
            c.nome,
            c.cpf,
            c.numero_beneficio,
            c.vendedor_id,
            COALESCE(u.nome, '-') AS vendedor_nome,
            COALESCE(d.nome, '-') AS digitador_nome
        FROM operacoes o
        JOIN clientes c ON c.id = o.cliente_id
        LEFT JOIN usuarios u ON u.id = c.vendedor_id
        LEFT JOIN usuarios d ON d.id = o.digitador_id
        WHERE {where_clause}
        ORDER BY o.criado_em ASC
    """, tuple(params))

    operations = [
        hydrate_operation_payload(operation)
        for operation in cursor.fetchall()
    ]

    for operation in operations:
        operation["status"] = normalize_operation_status(operation.get("status"))

    cursor.close()
    db.close()

    return jsonify(operations), 200


# ======================================================
# Ã°Å¸â€œÅ  ADMIN - RELATÃƒâ€œRIO DE OPERAÃƒâ€¡Ãƒâ€¢ES FINALIZADAS
# ======================================================

@clients_bp.route("/operations/report", methods=["GET"])
@jwt_required()
def get_operations_report():
    role = normalize_role(current_user_role())
    user_id = current_user_id()

    if role not in REPORT_ALLOWED_ROLES:
        return jsonify({"error": "Acesso restrito"}), 403

    status = (request.args.get("status") or "").strip().upper()
    requested_vendedor_id = request.args.get("vendedor_id", type=int)
    date_from = (request.args.get("date_from") or "").strip()
    date_to = (request.args.get("date_to") or "").strip()
    search = (request.args.get("search") or "").strip()

    if is_admin_like_role(role):
        vendedor_id = requested_vendedor_id
    elif role == ROLE_VENDOR:
        vendedor_id = user_id
    else:
        vendedor_id = requested_vendedor_id

    allowed_status = {"APROVADO", "REPROVADO"}

    if status and status not in allowed_status:
        return jsonify({"error": "status invÃƒÂ¡lido"}), 400

    parsed_from = None
    parsed_to = None

    try:
        if date_from:
            parsed_from = datetime.strptime(normalize_date_text(date_from), "%Y-%m-%d")
            date_from = parsed_from.strftime("%Y-%m-%d")
        if date_to:
            parsed_to = datetime.strptime(normalize_date_text(date_to), "%Y-%m-%d")
            date_to = parsed_to.strftime("%Y-%m-%d")
    except ValueError:
        return jsonify({"error": "Formato de data invÃƒÂ¡lido. Use YYYY-MM-DD."}), 400

    if parsed_from and parsed_to and parsed_from > parsed_to:
        return jsonify({"error": "date_from nÃƒÂ£o pode ser maior que date_to"}), 400

    db = get_db()
    cursor = db.cursor(dictionary=True)

    conditions = [
        "o.status IN ('APROVADO', 'REPROVADO')"
    ]
    params = []

    if status:
        conditions.append("o.status = %s")
        params.append(status)

    if vendedor_id:
        conditions.append("c.vendedor_id = %s")
        params.append(vendedor_id)

    apply_role_product_scope(role, conditions, params, "o.produto")

    if date_from:
        conditions.append("DATE(o.criado_em) >= %s")
        params.append(date_from)

    if date_to:
        conditions.append("DATE(o.criado_em) <= %s")
        params.append(date_to)

    if search:
        like_term = f"%{search}%"
        conditions.append(
            """(
                c.nome LIKE %s
                OR c.cpf LIKE %s
                OR o.produto LIKE %s
                OR o.banco_digitacao LIKE %s
                OR u.nome LIKE %s
            )"""
        )
        params.extend([like_term, like_term, like_term, like_term, like_term])

    where_clause = " AND ".join(conditions)

    cursor.execute(
        f"""
        SELECT
            o.id,
            o.cliente_id,
            c.nome AS cliente_nome,
            c.cpf,
            c.vendedor_id,
            COALESCE(u.nome, '-') AS vendedor_nome,
            o.produto,
            o.banco_digitacao,
            o.valor_liberado,
            o.parcela_liberada,
            o.prazo,
            o.status,
            o.criado_em
        FROM operacoes o
        JOIN clientes c ON c.id = o.cliente_id
        LEFT JOIN usuarios u ON u.id = c.vendedor_id
        WHERE {where_clause}
        ORDER BY o.criado_em DESC
        """,
        tuple(params)
    )

    operations = cursor.fetchall()

    vendors = []
    if is_admin_like_role(role):
        cursor.execute(
            """
            SELECT DISTINCT
                u.id,
                u.nome
            FROM usuarios u
            JOIN clientes c ON c.vendedor_id = u.id
            JOIN operacoes o ON o.cliente_id = c.id
            WHERE o.status IN ('APROVADO', 'REPROVADO')
            ORDER BY u.nome ASC
            """
        )
        vendors = cursor.fetchall()

    cursor.close()
    db.close()

    return jsonify({
        "operations": operations,
        "vendors": vendors
    }), 200


# ======================================================
# Ã°Å¸â€œÅ  ADMIN - ESTATÃƒÂSTICAS DA ESTEIRA
# ======================================================

@clients_bp.route("/operations/stats", methods=["GET"])
@jwt_required()
def get_operations_stats():

    if not is_admin():
        return jsonify({"error": "Acesso restrito"}), 403

    period = request.args.get("period", "day")

    db = get_db()
    cursor = db.cursor(dictionary=True)

    if period == "day":
        date_filter = "DATE(o.criado_em) = CURDATE()"
    elif period == "week":
        date_filter = "YEARWEEK(o.criado_em, 1) = YEARWEEK(CURDATE(), 1)"
    elif period == "month":
        date_filter = "MONTH(o.criado_em) = MONTH(CURDATE()) AND YEAR(o.criado_em)=YEAR(CURDATE())"
    else:
        return jsonify({"error": "PerÃƒÂ­odo invÃƒÂ¡lido"}), 400

    active_status_placeholders = ", ".join(
        ["%s"] * len(PIPELINE_ACTIVE_STATUSES_WITH_LEGACY)
    )
    cursor.execute(
        f"""
        SELECT
            SUM(CASE WHEN o.status='APROVADO' THEN 1 ELSE 0 END) as aprovados,
            SUM(
                CASE
                    WHEN o.status IN ({active_status_placeholders})
                         AND (
                            o.status NOT IN ('PRONTA_DIGITAR', 'PENDENTE')
                            OR o.enviada_esteira_em IS NOT NULL
                         ) THEN 1
                    ELSE 0
                END
            ) as em_analise,
            SUM(CASE WHEN o.status='REPROVADO' THEN 1 ELSE 0 END) as reprovados
        FROM operacoes o
        WHERE {date_filter}
        """,
        tuple(PIPELINE_ACTIVE_STATUSES_WITH_LEGACY),
    )

    stats = cursor.fetchone()

    cursor.close()
    db.close()

    return jsonify(stats), 200


# ======================================================
# DASHBOARD - RESUMO MENSAL
# ======================================================

@clients_bp.route("/dashboard/summary", methods=["GET"])
@jwt_required()
def get_dashboard_summary():
    now = datetime.now()
    month = request.args.get("month", type=int) or now.month
    year = request.args.get("year", type=int) or now.year
    requested_vendor_id = request.args.get("vendedor_id", type=int)

    period_start, period_end, period_error = parse_dashboard_period(month, year)
    if period_error:
        return jsonify({"error": period_error}), 400

    role = normalize_role(current_user_role())
    if is_admin_like_role(role) or is_digitador_role(role):
        selected_vendor_id = requested_vendor_id
    else:
        selected_vendor_id = current_user_id()

    if selected_vendor_id is not None and selected_vendor_id < 1:
        return jsonify({"error": "vendedor_id invalido"}), 400

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        ensure_dashboard_goals_table(cursor, db)

        sent_statuses = PIPELINE_ACTIVE_STATUSES_WITH_LEGACY + (
            "APROVADO",
            "REPROVADO",
        )
        sent_status_placeholders = ", ".join(["%s"] * len(sent_statuses))
        allowed_role_products = allowed_products_for_role(role)
        role_product_clause = ""
        role_product_params = []

        if allowed_role_products:
            role_product_placeholders = ", ".join(["%s"] * len(allowed_role_products))
            role_product_clause = f" AND UPPER(o.produto) IN ({role_product_placeholders})"
            role_product_params = list(allowed_role_products)

        stats_params = list(sent_statuses) + [period_start, period_end]
        vendor_clause = ""

        if selected_vendor_id:
            vendor_clause = " AND c.vendedor_id = %s"
            stats_params.append(selected_vendor_id)

        stats_params.extend(role_product_params)

        cursor.execute(
            f"""
            SELECT
                COUNT(*) AS generated_operations,
                SUM(
                    CASE
                        WHEN o.status IN ({sent_status_placeholders})
                             AND (
                                o.status NOT IN ('PRONTA_DIGITAR', 'PENDENTE')
                                OR o.enviada_esteira_em IS NOT NULL
                             ) THEN 1
                        ELSE 0
                    END
                ) AS sent_to_pipeline
            FROM operacoes o
            JOIN clientes c ON c.id = o.cliente_id
            WHERE o.criado_em >= %s
              AND o.criado_em < %s
              {vendor_clause}
              {role_product_clause}
            """,
            tuple(stats_params),
        )
        stats_row = cursor.fetchone() or {}

        approved_params = [period_start, period_end]
        approved_vendor_clause = ""

        if selected_vendor_id:
            approved_vendor_clause = " AND c.vendedor_id = %s"
            approved_params.append(selected_vendor_id)

        approved_params.extend(role_product_params)

        cursor.execute(
            f"""
            SELECT
                COUNT(*) AS approved_operations,
                COALESCE(
                    SUM(
                        COALESCE(o.valor_liberado, o.valor_solicitado, 0)
                    ),
                    0
                ) AS approved_value
            FROM operacoes o
            JOIN clientes c ON c.id = o.cliente_id
            WHERE o.status = 'APROVADO'
              AND COALESCE(o.data_pagamento, o.criado_em) >= %s
              AND COALESCE(o.data_pagamento, o.criado_em) < %s
              {approved_vendor_clause}
              {role_product_clause}
            """,
            tuple(approved_params),
        )
        approved_row = cursor.fetchone() or {}

        pipeline_status_placeholders = ", ".join(
            ["%s"] * len(PIPELINE_ACTIVE_STATUSES_WITH_LEGACY)
        )
        pipeline_params = list(PIPELINE_ACTIVE_STATUSES_WITH_LEGACY)
        pipeline_vendor_clause = ""

        if selected_vendor_id:
            pipeline_vendor_clause = " AND c.vendedor_id = %s"
            pipeline_params.append(selected_vendor_id)

        pipeline_params.extend(role_product_params)

        cursor.execute(
            f"""
            SELECT COUNT(*) AS in_pipeline
            FROM operacoes o
            JOIN clientes c ON c.id = o.cliente_id
            WHERE o.status IN ({pipeline_status_placeholders})
              AND (
                  o.status NOT IN ('PRONTA_DIGITAR', 'PENDENTE')
                  OR o.enviada_esteira_em IS NOT NULL
              )
              {pipeline_vendor_clause}
              {role_product_clause}
            """,
            tuple(pipeline_params),
        )
        pipeline_row = cursor.fetchone() or {}

        series_params = [year]
        series_vendor_clause = ""

        if selected_vendor_id:
            series_vendor_clause = " AND c.vendedor_id = %s"
            series_params.append(selected_vendor_id)

        series_params.extend(role_product_params)

        cursor.execute(
            f"""
            SELECT
                MONTH(COALESCE(o.data_pagamento, o.criado_em)) AS month_num,
                COALESCE(
                    SUM(
                        COALESCE(o.valor_liberado, o.valor_solicitado, 0)
                    ),
                    0
                ) AS total
            FROM operacoes o
            JOIN clientes c ON c.id = o.cliente_id
            WHERE o.status = 'APROVADO'
              AND YEAR(COALESCE(o.data_pagamento, o.criado_em)) = %s
              {series_vendor_clause}
              {role_product_clause}
            GROUP BY MONTH(COALESCE(o.data_pagamento, o.criado_em))
            """,
            tuple(series_params),
        )
        series_rows = cursor.fetchall()

        approved_by_month = {
            to_int(row.get("month_num")): round(to_number(row.get("total")), 2)
            for row in series_rows
        }
        monthly_approved = [
            {
                "month": i,
                "label": MONTH_LABELS[i - 1],
                "approved_value": approved_by_month.get(i, 0),
            }
            for i in range(1, 13)
        ]

        approved_by_product_params = [period_start, period_end]
        approved_by_product_vendor_clause = ""

        if selected_vendor_id:
            approved_by_product_vendor_clause = " AND c.vendedor_id = %s"
            approved_by_product_params.append(selected_vendor_id)

        approved_by_product_params.extend(role_product_params)

        cursor.execute(
            f"""
            SELECT
                UPPER(TRIM(COALESCE(o.produto, ''))) AS product_key,
                COALESCE(NULLIF(TRIM(o.produto), ''), 'SEM_PRODUTO') AS product_label,
                COUNT(*) AS approved_operations,
                COALESCE(
                    SUM(
                        COALESCE(o.valor_liberado, o.valor_solicitado, 0)
                    ),
                    0
                ) AS approved_value
            FROM operacoes o
            JOIN clientes c ON c.id = o.cliente_id
            WHERE o.status = 'APROVADO'
              AND COALESCE(o.data_pagamento, o.criado_em) >= %s
              AND COALESCE(o.data_pagamento, o.criado_em) < %s
              {approved_by_product_vendor_clause}
              {role_product_clause}
            GROUP BY
                UPPER(TRIM(COALESCE(o.produto, ''))),
                COALESCE(NULLIF(TRIM(o.produto), ''), 'SEM_PRODUTO')
            ORDER BY approved_value DESC, product_label ASC
            """,
            tuple(approved_by_product_params),
        )
        approved_by_product_rows = cursor.fetchall()
        approved_by_product = [
            {
                "product_key": row.get("product_key") or "SEM_PRODUTO",
                "product_label": row.get("product_label") or "SEM_PRODUTO",
                "approved": to_int(row.get("approved_operations")),
                "approved_value": round(to_number(row.get("approved_value")), 2),
            }
            for row in approved_by_product_rows
        ]

        vendors = []
        if is_admin_like_role(role):
            cursor.execute(
                """
                SELECT id, nome
                FROM usuarios
                WHERE UPPER(role) = 'VENDEDOR'
                ORDER BY nome ASC
                """
            )
            vendors = cursor.fetchall()
        elif is_digitador_role(role):
            if role_product_params:
                role_vendor_placeholders = ", ".join(
                    ["%s"] * len(role_product_params)
                )
                cursor.execute(
                    f"""
                    SELECT DISTINCT
                        u.id,
                        u.nome
                    FROM usuarios u
                    JOIN clientes c ON c.vendedor_id = u.id
                    JOIN operacoes o ON o.cliente_id = c.id
                    WHERE UPPER(u.role) = 'VENDEDOR'
                      AND UPPER(o.produto) IN ({role_vendor_placeholders})
                    ORDER BY u.nome ASC
                    """,
                    tuple(role_product_params),
                )
                vendors = cursor.fetchall()
            else:
                cursor.execute(
                    """
                    SELECT id, nome
                    FROM usuarios
                    WHERE UPPER(role) = 'VENDEDOR'
                    ORDER BY nome ASC
                    """
                )
                vendors = cursor.fetchall()

        vendor_stats_pipeline_placeholders = ", ".join(
            ["%s"] * len(PIPELINE_ACTIVE_STATUSES_WITH_LEGACY)
        )
        vendor_stats_params = [
            *PIPELINE_ACTIVE_STATUSES_WITH_LEGACY,
            period_start,
            period_end,
            period_start,
            period_end,
            period_start,
            period_end,
        ]
        vendor_stats_clause = ""

        if selected_vendor_id:
            vendor_stats_clause = " AND c.vendedor_id = %s"
            vendor_stats_params.append(selected_vendor_id)

        vendor_stats_params.extend(role_product_params)

        cursor.execute(
            f"""
            SELECT
                c.vendedor_id,
                COALESCE(u.nome, '-') AS vendedor_nome,
                COUNT(*) AS generated_operations,
                SUM(
                    CASE
                        WHEN o.status IN ({vendor_stats_pipeline_placeholders})
                             AND (
                                o.status NOT IN ('PRONTA_DIGITAR', 'PENDENTE')
                                OR o.enviada_esteira_em IS NOT NULL
                             ) THEN 1
                        ELSE 0
                    END
                ) AS in_pipeline,
                SUM(
                    CASE
                        WHEN o.status = 'APROVADO'
                             AND COALESCE(o.data_pagamento, o.criado_em) >= %s
                             AND COALESCE(o.data_pagamento, o.criado_em) < %s
                        THEN 1
                        ELSE 0
                    END
                ) AS approved_operations,
                COALESCE(
                    SUM(
                        CASE
                            WHEN o.status = 'APROVADO'
                                 AND COALESCE(o.data_pagamento, o.criado_em) >= %s
                                 AND COALESCE(o.data_pagamento, o.criado_em) < %s
                            THEN COALESCE(o.valor_liberado, o.valor_solicitado, 0)
                            ELSE 0
                        END
                    ),
                    0
                ) AS approved_value
            FROM operacoes o
            JOIN clientes c ON c.id = o.cliente_id
            LEFT JOIN usuarios u ON u.id = c.vendedor_id
            WHERE o.criado_em >= %s
              AND o.criado_em < %s
              {vendor_stats_clause}
              {role_product_clause}
            GROUP BY c.vendedor_id, u.nome
            ORDER BY u.nome ASC
            """,
            tuple(vendor_stats_params),
        )
        vendor_stats_rows = cursor.fetchall()
        vendors_product_stats = [
            {
                "vendedor_id": to_int(row.get("vendedor_id")),
                "vendedor_nome": row.get("vendedor_nome") or "-",
                "generated": to_int(row.get("generated_operations")),
                "in_pipeline": to_int(row.get("in_pipeline")),
                "approved": to_int(row.get("approved_operations")),
                "approved_value": round(to_number(row.get("approved_value")), 2),
            }
            for row in vendor_stats_rows
        ]

        selected_vendor = None
        if selected_vendor_id:
            cursor.execute(
                """
                SELECT id, nome
                FROM usuarios
                WHERE id = %s
                  AND UPPER(role) = 'VENDEDOR'
                LIMIT 1
                """,
                (selected_vendor_id,),
            )
            selected_vendor = cursor.fetchone()
            if not selected_vendor:
                return jsonify({"error": "Vendedor nao encontrado"}), 404

        goal_target, goal_source = resolve_dashboard_goal(
            cursor,
            year,
            month,
            selected_vendor_id,
        )

        generated_operations = to_int(stats_row.get("generated_operations"))
        sent_to_pipeline = to_int(stats_row.get("sent_to_pipeline"))
        approved_operations = to_int(approved_row.get("approved_operations"))
        approved_value = round(to_number(approved_row.get("approved_value")), 2)
        in_pipeline = to_int(pipeline_row.get("in_pipeline"))
        progress = round((approved_value / goal_target) * 100, 2) if goal_target else 0
        scope = "INDIVIDUAL"

        if is_admin_like_role(role) and not selected_vendor_id:
            scope = "GERAL"
        elif is_digitador_role(role) and not selected_vendor_id:
            scope = "PRODUTO"
        elif is_digitador_role(role):
            scope = "PRODUTO_VENDEDOR"

        return jsonify(
            {
                "scope": scope,
                "period": {
                    "month": month,
                    "year": year,
                },
                "product_scope": list(allowed_role_products),
                "goal": {
                    "target": round(goal_target, 2),
                    "source": goal_source,
                },
                "operations": {
                    "generated": generated_operations,
                    "sent_to_pipeline": sent_to_pipeline,
                    "approved": approved_operations,
                    "approved_value": approved_value,
                    "in_pipeline": in_pipeline,
                },
                "progress": {
                    "percentage": progress,
                    "remaining": round(max(goal_target - approved_value, 0), 2),
                },
                "selected_vendor": selected_vendor,
                "vendors": vendors,
                "vendors_product_stats": vendors_product_stats,
                "monthly_approved": monthly_approved,
                "approved_by_product": approved_by_product,
            }
        ), 200
    finally:
        cursor.close()
        db.close()


# ======================================================
# DASHBOARD - ATUALIZAR META
# ======================================================

@clients_bp.route("/dashboard/goal", methods=["PUT"])
@jwt_required()
def upsert_dashboard_goal():
    if not is_admin():
        return jsonify({"error": "Somente ADMIN/GLOBAL pode alterar a meta"}), 403

    data = request.get_json() or {}
    now = datetime.now()

    month = data.get("month", now.month)
    year = data.get("year", now.year)
    target = data.get("target")
    raw_vendor_id = data.get("vendedor_id")

    try:
        month = int(month)
        year = int(year)
        target = float(target)
    except (TypeError, ValueError):
        return jsonify({"error": "Mes, ano e target devem ser numericos"}), 400

    _, _, period_error = parse_dashboard_period(month, year)
    if period_error:
        return jsonify({"error": period_error}), 400

    if target <= 0:
        return jsonify({"error": "A meta deve ser maior que zero"}), 400

    target = round(target, 2)

    if raw_vendor_id in (None, "", 0, "0"):
        vendor_id = 0
    else:
        try:
            vendor_id = int(raw_vendor_id)
        except (TypeError, ValueError):
            return jsonify({"error": "vendedor_id invalido"}), 400

        if vendor_id < 1:
            return jsonify({"error": "vendedor_id invalido"}), 400

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        ensure_dashboard_goals_table(cursor, db)

        cursor.execute(
            """
            INSERT INTO dashboard_goals (
                year,
                month,
                vendedor_id,
                target,
                updated_by
            )
            VALUES (%s, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                target = VALUES(target),
                updated_by = VALUES(updated_by),
                updated_at = CURRENT_TIMESTAMP
            """,
            (
                year,
                month,
                vendor_id,
                target,
                current_user_id(),
            ),
        )
        db.commit()

        return jsonify(
            {
                "message": "Meta atualizada com sucesso",
                "goal": {
                    "year": year,
                    "month": month,
                    "vendedor_id": vendor_id,
                    "target": round(target, 2),
                },
            }
        ), 200
    finally:
        cursor.close()
        db.close()


# ======================================================
# NOTIFICACOES DE OPERACOES
# ======================================================

@clients_bp.route("/notifications", methods=["GET"])
@jwt_required()
def list_user_notifications():
    user_id = current_user_id()
    unread_only_raw = str(request.args.get("unread_only") or "").strip().lower()
    unread_only = unread_only_raw in {"1", "true", "yes", "sim"}
    limit = request.args.get("limit", type=int) or 20
    limit = max(1, min(limit, 100))

    db = None
    cursor = None

    try:
        db = get_db()
        cursor = db.cursor(dictionary=True)
        ensure_operation_notifications_table(cursor, db)

        conditions = ["user_id = %s"]
        params = [user_id]

        if unread_only:
            conditions.append("read_at IS NULL")

        where_clause = " AND ".join(conditions)
        params_with_limit = [*params, limit]

        cursor.execute(
            f"""
            SELECT
                id,
                operation_id,
                previous_status,
                next_status,
                title,
                message,
                read_at,
                created_at
            FROM operation_notifications
            WHERE {where_clause}
            ORDER BY created_at DESC, id DESC
            LIMIT %s
            """,
            tuple(params_with_limit),
        )
        notifications = cursor.fetchall()

        for item in notifications:
            previous_status = item.get("previous_status")
            item["previous_status"] = (
                normalize_operation_status(previous_status) if previous_status else None
            )
            item["next_status"] = normalize_operation_status(item.get("next_status"))
            item["read"] = item.get("read_at") is not None

        cursor.execute(
            """
            SELECT COUNT(*) AS unread_count
            FROM operation_notifications
            WHERE user_id = %s
              AND read_at IS NULL
            """,
            (user_id,),
        )
        unread_count = to_int((cursor.fetchone() or {}).get("unread_count"))

        return jsonify(
            {
                "notifications": notifications,
                "unread_count": unread_count,
            }
        ), 200
    except mysql.connector.Error as exc:
        if is_transient_db_connection_error(exc):
            current_app.logger.warning(
                "Falha temporaria ao carregar notificacoes do usuario %s: %s",
                user_id,
                exc,
            )
            return jsonify(
                {
                    "notifications": [],
                    "unread_count": 0,
                    "degraded": True,
                }
            ), 200
        raise
    finally:
        if cursor is not None:
            cursor.close()
        if db is not None:
            db.close()


@clients_bp.route("/notifications/unread-count", methods=["GET"])
@jwt_required()
def get_user_notifications_unread_count():
    user_id = current_user_id()

    db = None
    cursor = None

    try:
        db = get_db()
        cursor = db.cursor(dictionary=True)
        ensure_operation_notifications_table(cursor, db)
        cursor.execute(
            """
            SELECT COUNT(*) AS unread_count
            FROM operation_notifications
            WHERE user_id = %s
              AND read_at IS NULL
            """,
            (user_id,),
        )
        unread_count = to_int((cursor.fetchone() or {}).get("unread_count"))

        return jsonify(
            {
                "unread_count": unread_count,
            }
        ), 200
    except mysql.connector.Error as exc:
        if is_transient_db_connection_error(exc):
            current_app.logger.warning(
                "Falha temporaria ao contar notificacoes do usuario %s: %s",
                user_id,
                exc,
            )
            return jsonify({"unread_count": 0, "degraded": True}), 200
        raise
    finally:
        if cursor is not None:
            cursor.close()
        if db is not None:
            db.close()


@clients_bp.route("/notifications/<int:notification_id>/read", methods=["PUT"])
@jwt_required()
def mark_user_notification_as_read(notification_id):
    user_id = current_user_id()

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        ensure_operation_notifications_table(cursor, db)

        cursor.execute(
            """
            SELECT id, read_at
            FROM operation_notifications
            WHERE id = %s
              AND user_id = %s
            LIMIT 1
            """,
            (notification_id, user_id),
        )
        notification = cursor.fetchone()
        if not notification:
            return jsonify({"error": "Notificacao nao encontrada"}), 404

        if notification.get("read_at") is None:
            cursor.execute(
                """
                UPDATE operation_notifications
                SET read_at = NOW()
                WHERE id = %s
                  AND user_id = %s
                """,
                (notification_id, user_id),
            )
            db.commit()

        return jsonify({"message": "Notificacao marcada como lida"}), 200
    finally:
        cursor.close()
        db.close()


@clients_bp.route("/notifications/read-all", methods=["PUT"])
@jwt_required()
def mark_all_user_notifications_as_read():
    user_id = current_user_id()

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        ensure_operation_notifications_table(cursor, db)
        cursor.execute(
            """
            UPDATE operation_notifications
            SET read_at = NOW()
            WHERE user_id = %s
              AND read_at IS NULL
            """,
            (user_id,),
        )
        db.commit()

        return jsonify(
            {
                "message": "Notificacoes marcadas como lidas",
                "updated": cursor.rowcount,
            }
        ), 200
    finally:
        cursor.close()
        db.close()


# ======================================================
# DASHBOARD - NOTIFICACOES DO SINO
# ======================================================

@clients_bp.route("/dashboard/notifications", methods=["GET"])
@jwt_required()
def get_dashboard_notifications():
    role = normalize_role(current_user_role())

    if is_admin_like_role(role):
        vendor_id = None
    elif role == ROLE_VENDOR:
        vendor_id = current_user_id()
    elif is_digitador_role(role):
        vendor_id = None
    else:
        return jsonify({"error": "Acesso restrito"}), 403

    db = None
    cursor = None

    try:
        db = get_db()
        cursor = db.cursor(dictionary=True)
        active_status_placeholders = ", ".join(
            ["%s"] * len(PIPELINE_ACTIVE_STATUSES_WITH_LEGACY)
        )
        params = list(PIPELINE_ACTIVE_STATUSES_WITH_LEGACY)
        conditions = [
            f"o.status IN ({active_status_placeholders})",
            """(
                o.status NOT IN ('PRONTA_DIGITAR', 'PENDENTE')
                OR o.enviada_esteira_em IS NOT NULL
            )""",
        ]

        if vendor_id:
            conditions.append("c.vendedor_id = %s")
            params.append(vendor_id)

        apply_role_product_scope(role, conditions, params, "o.produto")
        where_clause = " AND ".join(conditions)

        cursor.execute(
            f"""
            SELECT COUNT(*) AS pipeline_count
            FROM operacoes o
            JOIN clientes c ON c.id = o.cliente_id
            WHERE {where_clause}
            """,
            tuple(params),
        )
        row = cursor.fetchone() or {}
        pipeline_count = to_int(row.get("pipeline_count"))

        return jsonify(
            {
                "pipeline_count": pipeline_count,
                "has_pipeline": pipeline_count > 0,
            }
        ), 200
    except mysql.connector.Error as exc:
        if is_transient_db_connection_error(exc):
            current_app.logger.warning(
                "Falha temporaria ao carregar resumo de notificacoes do dashboard para role %s: %s",
                role,
                exc,
            )
            return jsonify(
                {
                    "pipeline_count": 0,
                    "has_pipeline": False,
                    "degraded": True,
                }
            ), 200
        raise
    finally:
        if cursor is not None:
            cursor.close()
        if db is not None:
            db.close()

