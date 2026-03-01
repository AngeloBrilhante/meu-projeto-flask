import base64
import hmac
import json
import secrets
import struct
import time
from datetime import date, datetime
from decimal import Decimal
from hashlib import sha1
from urllib.parse import quote

from flask import request

ROLE_ADMIN = "ADMIN"
ROLE_GLOBAL = "GLOBAL"

TOTP_PERIOD_SECONDS = 30
TOTP_DIGITS = 6
TOTP_WINDOW_STEPS = 1


def normalize_role(role):
    return str(role or "").strip().upper()


def json_default_serializer(value):
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(value, date):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, Decimal):
        return float(value)
    raise TypeError(f"Tipo nao serializavel: {type(value).__name__}")


def json_dumps(value):
    return json.dumps(value, ensure_ascii=False, default=json_default_serializer)


def json_loads(value):
    if isinstance(value, (dict, list)):
        return value
    text = str(value or "").strip()
    if not text:
        return None
    return json.loads(text)


def ensure_audit_logs_table(cursor, db):
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS audit_logs (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            actor_id INT NULL,
            actor_role VARCHAR(30) NULL,
            action VARCHAR(120) NOT NULL,
            target_type VARCHAR(60) NULL,
            target_id INT NULL,
            success TINYINT(1) NOT NULL DEFAULT 1,
            reason VARCHAR(255) NULL,
            metadata LONGTEXT NULL,
            ip_address VARCHAR(64) NULL,
            user_agent VARCHAR(255) NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_audit_logs_created (created_at),
            INDEX idx_audit_logs_actor (actor_id, created_at),
            INDEX idx_audit_logs_target (target_type, target_id, created_at)
        )
        """
    )
    db.commit()


def ensure_trash_bin_table(cursor, db):
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS trash_bin (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            entity_type VARCHAR(40) NOT NULL,
            entity_id INT NOT NULL,
            payload LONGTEXT NOT NULL,
            deleted_by INT NULL,
            deleted_role VARCHAR(30) NULL,
            reason VARCHAR(255) NULL,
            deleted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            restored_at DATETIME NULL,
            restored_by INT NULL,
            restore_note VARCHAR(255) NULL,
            INDEX idx_trash_entity (entity_type, entity_id),
            INDEX idx_trash_restored (restored_at, deleted_at)
        )
        """
    )
    db.commit()


def ensure_system_settings_table(cursor, db):
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS system_settings (
            setting_key VARCHAR(80) PRIMARY KEY,
            setting_value LONGTEXT NULL,
            updated_by INT NULL,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
        """
    )
    db.commit()


def ensure_user_security_columns(cursor, db):
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

    if "twofa_secret" not in columns:
        cursor.execute("ALTER TABLE usuarios ADD COLUMN twofa_secret VARCHAR(64) NULL")
        changed = True

    if "twofa_enabled" not in columns:
        cursor.execute("ALTER TABLE usuarios ADD COLUMN twofa_enabled TINYINT(1) NOT NULL DEFAULT 0")
        changed = True

    if changed:
        db.commit()


def get_request_ip():
    forwarded_for = request.headers.get("X-Forwarded-For") or ""
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()[:64]
    return (request.remote_addr or "")[:64]


def get_request_user_agent():
    return (request.headers.get("User-Agent") or "")[:255]


def log_audit(
    cursor,
    actor_id,
    actor_role,
    action,
    target_type=None,
    target_id=None,
    success=True,
    reason=None,
    metadata=None,
):
    metadata_text = None
    if metadata is not None:
        metadata_text = json_dumps(metadata)

    cursor.execute(
        """
        INSERT INTO audit_logs (
            actor_id,
            actor_role,
            action,
            target_type,
            target_id,
            success,
            reason,
            metadata,
            ip_address,
            user_agent
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            actor_id,
            normalize_role(actor_role),
            str(action or "").strip()[:120],
            (str(target_type or "").strip() or None),
            target_id,
            1 if success else 0,
            (str(reason or "").strip()[:255] or None),
            metadata_text,
            get_request_ip(),
            get_request_user_agent(),
        ),
    )


def add_to_trash(cursor, entity_type, entity_id, payload, deleted_by, deleted_role, reason=None):
    payload_text = json_dumps(payload or {})
    cursor.execute(
        """
        INSERT INTO trash_bin (
            entity_type,
            entity_id,
            payload,
            deleted_by,
            deleted_role,
            reason
        )
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (
            str(entity_type or "").strip().upper(),
            int(entity_id),
            payload_text,
            deleted_by,
            normalize_role(deleted_role),
            (str(reason or "").strip()[:255] or None),
        ),
    )
    return cursor.lastrowid


def get_maintenance_state(cursor):
    cursor.execute(
        """
        SELECT setting_value
        FROM system_settings
        WHERE setting_key = 'maintenance_mode'
        LIMIT 1
        """
    )
    row = cursor.fetchone()
    data = json_loads((row or {}).get("setting_value")) if row else None
    if not isinstance(data, dict):
        return {"enabled": False, "message": "Sistema em manutencao"}
    enabled = bool(data.get("enabled"))
    message = str(data.get("message") or "Sistema em manutencao").strip() or "Sistema em manutencao"
    return {"enabled": enabled, "message": message}


def set_maintenance_state(cursor, enabled, message, updated_by):
    payload = json_dumps(
        {
            "enabled": bool(enabled),
            "message": str(message or "Sistema em manutencao").strip() or "Sistema em manutencao",
        }
    )
    cursor.execute(
        """
        INSERT INTO system_settings (
            setting_key,
            setting_value,
            updated_by
        )
        VALUES ('maintenance_mode', %s, %s)
        ON DUPLICATE KEY UPDATE
            setting_value = VALUES(setting_value),
            updated_by = VALUES(updated_by),
            updated_at = CURRENT_TIMESTAMP
        """,
        (payload, updated_by),
    )


def generate_totp_secret(length=32):
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
    return "".join(secrets.choice(alphabet) for _ in range(max(16, int(length))))


def _normalize_base32(secret):
    text = str(secret or "").strip().replace(" ", "").upper()
    if not text:
        return ""
    padding = "=" * ((8 - (len(text) % 8)) % 8)
    return text + padding


def generate_totp_code(secret, for_time=None, period=TOTP_PERIOD_SECONDS, digits=TOTP_DIGITS):
    normalized = _normalize_base32(secret)
    if not normalized:
        return None

    try:
        key = base64.b32decode(normalized, casefold=True)
    except Exception:
        return None

    timestamp = int(time.time() if for_time is None else for_time)
    counter = int(timestamp // period)
    msg = struct.pack(">Q", counter)
    digest = hmac.new(key, msg, sha1).digest()
    offset = digest[-1] & 0x0F
    code_int = (struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF) % (10**digits)
    return f"{code_int:0{digits}d}"


def verify_totp_code(secret, code, window=TOTP_WINDOW_STEPS):
    clean_code = "".join(ch for ch in str(code or "") if ch.isdigit())
    if len(clean_code) != TOTP_DIGITS:
        return False

    now = int(time.time())
    for step in range(-window, window + 1):
        expected = generate_totp_code(secret, for_time=now + (step * TOTP_PERIOD_SECONDS))
        if expected and hmac.compare_digest(expected, clean_code):
            return True
    return False


def build_otpauth_uri(secret, email, issuer="Aureon Capital"):
    issuer_text = str(issuer or "Aureon Capital").strip() or "Aureon Capital"
    account = str(email or "usuario").strip() or "usuario"
    label = quote(f"{issuer_text}:{account}")
    issuer_param = quote(issuer_text)
    return (
        f"otpauth://totp/{label}"
        f"?secret={secret}"
        f"&issuer={issuer_param}"
        f"&period={TOTP_PERIOD_SECONDS}"
        f"&digits={TOTP_DIGITS}"
    )


def get_twofa_code_from_request():
    header_code = request.headers.get("X-2FA-Code")
    if header_code:
        return str(header_code).strip()

    body = request.get_json(silent=True) or {}
    if isinstance(body, dict) and body.get("twofa_code"):
        return str(body.get("twofa_code")).strip()
    return ""


def verify_user_twofa(cursor, user_id, twofa_code):
    cursor.execute(
        """
        SELECT twofa_enabled, twofa_secret
        FROM usuarios
        WHERE id = %s
        LIMIT 1
        """,
        (user_id,),
    )
    row = cursor.fetchone()
    if not row:
        return False, "Usuario nao encontrado"

    enabled = bool(row.get("twofa_enabled"))
    secret = str(row.get("twofa_secret") or "").strip()

    if not enabled or not secret:
        return False, "2FA obrigatorio nao configurado para este usuario"

    if not verify_totp_code(secret, twofa_code):
        return False, "Codigo 2FA invalido"

    return True, ""


def row_to_insert_dict(row):
    result = {}
    for key, value in (row or {}).items():
        if isinstance(value, datetime):
            result[key] = value.strftime("%Y-%m-%d %H:%M:%S")
        elif isinstance(value, date):
            result[key] = value.strftime("%Y-%m-%d")
        elif isinstance(value, Decimal):
            result[key] = str(value)
        else:
            result[key] = value
    return result


def insert_row(cursor, table_name, row):
    if not row:
        return
    columns = list(row.keys())
    placeholders = ", ".join(["%s"] * len(columns))
    columns_sql = ", ".join(columns)
    cursor.execute(
        f"INSERT INTO {table_name} ({columns_sql}) VALUES ({placeholders})",
        tuple(row[col] for col in columns),
    )
