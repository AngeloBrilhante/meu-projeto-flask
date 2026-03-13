from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from app.database import get_db
from app.routes.clients import (
    deserialize_document_row_from_trash,
    ensure_documents_table,
    ensure_operation_comments_table,
    ensure_operation_notifications_table,
    ensure_operation_status_history_table,
    ensure_operations_extra_columns,
    serialize_document_row_for_trash,
    sync_storage_documents_to_db,
)
from app.routes.users import ensure_user_profile_columns
from app.utils.auth import current_user_id, current_user_role
from app.utils.security import (
    ROLE_GLOBAL,
    add_to_trash,
    ensure_audit_logs_table,
    ensure_system_settings_table,
    ensure_trash_bin_table,
    get_maintenance_state,
    get_twofa_code_from_request,
    insert_row,
    json_loads,
    log_audit,
    row_to_insert_dict,
    set_maintenance_state,
    verify_user_twofa,
)

system_bp = Blueprint("system", __name__)

CONFIRM_PHRASE_BULK_DELETE = "EXCLUIR_EM_LOTE"


def normalize_role(role):
    return str(role or "").strip().upper()


def actor_is_global():
    return normalize_role(current_user_role()) == ROLE_GLOBAL


def parse_bool(value):
    if isinstance(value, bool):
        return value
    text = str(value or "").strip().lower()
    if text in {"1", "true", "sim", "yes", "on"}:
        return True
    if text in {"0", "false", "nao", "no", "off"}:
        return False
    return None


def parse_id_list(values):
    if not isinstance(values, list):
        return []
    result = []
    seen = set()
    for item in values:
        try:
            value = int(item)
        except (TypeError, ValueError):
            continue
        if value <= 0 or value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def table_exists(cursor, table_name):
    cursor.execute(
        """
        SELECT 1
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = %s
        LIMIT 1
        """,
        (str(table_name),),
    )
    return cursor.fetchone() is not None


def record_exists(cursor, table_name, record_id):
    cursor.execute(
        f"""
        SELECT 1
        FROM {table_name}
        WHERE id = %s
        LIMIT 1
        """,
        (int(record_id),),
    )
    return cursor.fetchone() is not None


def require_global_twofa(cursor, actor_id):
    code = get_twofa_code_from_request()
    valid, error_message = verify_user_twofa(cursor, actor_id, code)
    if valid:
        return None
    return jsonify({"error": error_message}), 403


def delete_operation_record(cursor, operation_id, actor_id, actor_role, reason):
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
            actor_role=actor_role,
            action="DELETE_OPERATION",
            target_type="OPERACAO",
            target_id=operation_id,
            success=False,
            reason="Operacao nao encontrada",
        )
        return {"id": int(operation_id), "status": "not_found"}

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
        deleted_role=actor_role,
        reason=reason,
    )

    cursor.execute("DELETE FROM operation_comments WHERE operation_id = %s", (operation_id,))
    cursor.execute("DELETE FROM operation_status_history WHERE operation_id = %s", (operation_id,))
    cursor.execute("DELETE FROM operation_notifications WHERE operation_id = %s", (operation_id,))
    cursor.execute("DELETE FROM operacoes WHERE id = %s", (operation_id,))

    log_audit(
        cursor,
        actor_id=actor_id,
        actor_role=actor_role,
        action="DELETE_OPERATION",
        target_type="OPERACAO",
        target_id=operation_id,
        success=True,
        metadata={"trash_id": trash_id},
    )
    return {"id": int(operation_id), "status": "deleted", "trash_id": int(trash_id)}


def delete_client_record(cursor, db, client_id, actor_id, actor_role, reason):
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
            actor_role=actor_role,
            action="DELETE_CLIENT",
            target_type="CLIENTE",
            target_id=client_id,
            success=False,
            reason="Cliente nao encontrado",
        )
        return {"id": int(client_id), "status": "not_found"}

    cursor.execute(
        """
        SELECT *
        FROM operacoes
        WHERE cliente_id = %s
        ORDER BY id ASC
        """,
        (client_id,),
    )
    operations = cursor.fetchall()
    operation_ids = [
        int(item.get("id"))
        for item in operations
        if int(item.get("id") or 0) > 0
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
    sync_storage_documents_to_db(
        cursor,
        client_id,
        seller_id=int(client.get("vendedor_id") or 0) or None,
    )
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
            "operations": [row_to_insert_dict(item) for item in operations],
            "operation_comments": [row_to_insert_dict(item) for item in operation_comments],
            "operation_status_history": [row_to_insert_dict(item) for item in operation_history],
            "operation_notifications": [
                row_to_insert_dict(item) for item in operation_notifications
            ],
            "documents": [serialize_document_row_for_trash(item) for item in documents],
        },
        deleted_by=actor_id,
        deleted_role=actor_role,
        reason=reason,
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
        actor_role=actor_role,
        action="DELETE_CLIENT",
        target_type="CLIENTE",
        target_id=client_id,
        success=True,
        metadata={"trash_id": trash_id, "operations_count": len(operation_ids)},
    )
    return {
        "id": int(client_id),
        "status": "deleted",
        "trash_id": int(trash_id),
        "removed_operations": len(operation_ids),
    }


def delete_user_record(cursor, user_id, actor_id, actor_role, reason):
    if user_id == actor_id:
        log_audit(
            cursor,
            actor_id=actor_id,
            actor_role=actor_role,
            action="DELETE_USER",
            target_type="USUARIO",
            target_id=user_id,
            success=False,
            reason="Tentativa de autoexclusao",
        )
        return {
            "id": int(user_id),
            "status": "blocked",
            "reason": "Usuario GLOBAL nao pode excluir a propria conta",
        }

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
        log_audit(
            cursor,
            actor_id=actor_id,
            actor_role=actor_role,
            action="DELETE_USER",
            target_type="USUARIO",
            target_id=user_id,
            success=False,
            reason="Usuario nao encontrado",
        )
        return {"id": int(user_id), "status": "not_found"}

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
            return {
                "id": int(user_id),
                "status": "blocked",
                "reason": "Nao e permitido remover o ultimo usuario GLOBAL",
            }

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
        return {
            "id": int(user_id),
            "status": "blocked",
            "reason": "Usuario possui clientes vinculados",
            "clients_count": clients_count,
        }

    trash_id = add_to_trash(
        cursor,
        entity_type="USUARIO",
        entity_id=user_id,
        payload={"user": row_to_insert_dict(target)},
        deleted_by=actor_id,
        deleted_role=actor_role,
        reason=reason,
    )
    cursor.execute("DELETE FROM usuarios WHERE id = %s", (user_id,))
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
    return {"id": int(user_id), "status": "deleted", "trash_id": int(trash_id)}


def restore_operation_payload(cursor, payload):
    operation = payload.get("operation") if isinstance(payload, dict) else None
    if not isinstance(operation, dict):
        raise ValueError("Payload da operacao invalido")

    operation_id = int(operation.get("id") or 0)
    client_id = int(operation.get("cliente_id") or 0)
    if operation_id <= 0 or client_id <= 0:
        raise ValueError("Payload da operacao incompleto")

    if record_exists(cursor, "operacoes", operation_id):
        raise ValueError("Operacao ja existe no banco")
    if not record_exists(cursor, "clientes", client_id):
        raise ValueError("Cliente da operacao nao existe para restauracao")

    insert_row(cursor, "operacoes", operation)

    comments = payload.get("comments") or []
    for item in comments:
        if not isinstance(item, dict):
            continue
        row = dict(item)
        row.pop("id", None)
        insert_row(cursor, "operation_comments", row)

    history = payload.get("status_history") or []
    for item in history:
        if not isinstance(item, dict):
            continue
        row = dict(item)
        row.pop("id", None)
        insert_row(cursor, "operation_status_history", row)

    notifications = payload.get("notifications") or []
    for item in notifications:
        if not isinstance(item, dict):
            continue
        row = dict(item)
        row.pop("id", None)
        insert_row(cursor, "operation_notifications", row)

    return {"entity_type": "OPERACAO", "entity_id": operation_id}


def restore_client_payload(cursor, db, payload):
    client = payload.get("client") if isinstance(payload, dict) else None
    if not isinstance(client, dict):
        raise ValueError("Payload do cliente invalido")

    client_id = int(client.get("id") or 0)
    seller_id = int(client.get("vendedor_id") or 0)
    if client_id <= 0:
        raise ValueError("Payload do cliente incompleto")

    if record_exists(cursor, "clientes", client_id):
        raise ValueError("Cliente ja existe no banco")
    if seller_id > 0 and not record_exists(cursor, "usuarios", seller_id):
        raise ValueError("Vendedor vinculado nao existe para restauracao")

    insert_row(cursor, "clientes", client)

    operations = payload.get("operations") or []
    for item in operations:
        if not isinstance(item, dict):
            continue
        operation_id = int(item.get("id") or 0)
        if operation_id <= 0:
            continue
        if record_exists(cursor, "operacoes", operation_id):
            raise ValueError(f"Operacao {operation_id} ja existe no banco")
        insert_row(cursor, "operacoes", item)

    comments = payload.get("operation_comments") or []
    for item in comments:
        if not isinstance(item, dict):
            continue
        row = dict(item)
        row.pop("id", None)
        insert_row(cursor, "operation_comments", row)

    history = payload.get("operation_status_history") or []
    for item in history:
        if not isinstance(item, dict):
            continue
        row = dict(item)
        row.pop("id", None)
        insert_row(cursor, "operation_status_history", row)

    notifications = payload.get("operation_notifications") or []
    for item in notifications:
        if not isinstance(item, dict):
            continue
        row = dict(item)
        row.pop("id", None)
        insert_row(cursor, "operation_notifications", row)

    documents_restored = 0
    document_warnings = []
    documents = payload.get("documents") or []
    if documents:
        ensure_documents_table(cursor, db)
        for item in documents:
            if not isinstance(item, dict):
                continue
            row = deserialize_document_row_from_trash(item)
            row.pop("id", None)
            try:
                insert_row(cursor, "documentos", row)
                documents_restored += 1
            except Exception:
                document_warnings.append("Falha ao restaurar um documento (ignorado)")

    result = {
        "entity_type": "CLIENTE",
        "entity_id": client_id,
        "documents_restored": documents_restored,
    }
    if document_warnings:
        result["warnings"] = document_warnings
    return result


def restore_user_payload(cursor, payload):
    user = payload.get("user") if isinstance(payload, dict) else None
    if not isinstance(user, dict):
        raise ValueError("Payload do usuario invalido")

    user_id = int(user.get("id") or 0)
    if user_id <= 0:
        raise ValueError("Payload do usuario incompleto")

    if record_exists(cursor, "usuarios", user_id):
        raise ValueError("Usuario ja existe no banco")

    insert_row(cursor, "usuarios", user)
    return {"entity_type": "USUARIO", "entity_id": user_id}


@system_bp.route("/system/maintenance/status", methods=["GET"])
def get_system_maintenance_status():
    db = get_db()
    cursor = db.cursor(dictionary=True)
    try:
        ensure_system_settings_table(cursor, db)
        state = get_maintenance_state(cursor)
        return jsonify({"maintenance": state}), 200
    finally:
        cursor.close()
        db.close()


@system_bp.route("/system/maintenance", methods=["PUT"])
@jwt_required()
def update_system_maintenance():
    actor_id = current_user_id()
    actor_role = normalize_role(current_user_role())
    if actor_role != ROLE_GLOBAL:
        return jsonify({"error": "Somente GLOBAL pode alterar modo manutencao"}), 403

    data = request.get_json(silent=True) or {}
    enabled = parse_bool(data.get("enabled"))
    message = str(data.get("message") or "Sistema em manutencao").strip() or "Sistema em manutencao"
    if enabled is None:
        return jsonify({"error": "enabled deve ser booleano"}), 400

    db = get_db()
    cursor = db.cursor(dictionary=True)
    try:
        ensure_system_settings_table(cursor, db)
        ensure_audit_logs_table(cursor, db)

        twofa_error = require_global_twofa(cursor, actor_id)
        if twofa_error:
            log_audit(
                cursor,
                actor_id=actor_id,
                actor_role=actor_role,
                action="SET_MAINTENANCE_MODE",
                target_type="SYSTEM",
                success=False,
                reason="2FA invalido",
            )
            db.commit()
            return twofa_error

        set_maintenance_state(cursor, enabled=enabled, message=message, updated_by=actor_id)
        log_audit(
            cursor,
            actor_id=actor_id,
            actor_role=actor_role,
            action="SET_MAINTENANCE_MODE",
            target_type="SYSTEM",
            success=True,
            metadata={"enabled": enabled, "message": message},
        )
        db.commit()
        return jsonify(
            {
                "message": "Modo manutencao atualizado",
                "maintenance": {"enabled": enabled, "message": message},
            }
        ), 200
    finally:
        cursor.close()
        db.close()


@system_bp.route("/system/trash", methods=["GET"])
@jwt_required()
def list_trash():
    if not actor_is_global():
        return jsonify({"error": "Somente GLOBAL pode acessar a lixeira"}), 403

    entity_type = str(request.args.get("entity_type") or "").strip().upper()
    include_payload_raw = str(request.args.get("include_payload") or "").strip().lower()
    include_payload = include_payload_raw in {"1", "true", "sim", "yes"}
    restored_filter = str(request.args.get("restored") or "").strip().lower()
    limit = max(1, min(request.args.get("limit", type=int) or 30, 200))
    offset = max(0, request.args.get("offset", type=int) or 0)

    db = get_db()
    cursor = db.cursor(dictionary=True)
    try:
        ensure_trash_bin_table(cursor, db)
        conditions = ["1=1"]
        params = []

        if entity_type:
            conditions.append("entity_type = %s")
            params.append(entity_type)

        if restored_filter in {"0", "false", "nao"}:
            conditions.append("restored_at IS NULL")
        elif restored_filter in {"1", "true", "sim"}:
            conditions.append("restored_at IS NOT NULL")

        where_clause = " AND ".join(conditions)
        cursor.execute(
            f"""
            SELECT
                id,
                entity_type,
                entity_id,
                payload,
                deleted_by,
                deleted_role,
                reason,
                deleted_at,
                restored_at,
                restored_by,
                restore_note
            FROM trash_bin
            WHERE {where_clause}
            ORDER BY id DESC
            LIMIT %s OFFSET %s
            """,
            (*params, limit, offset),
        )
        rows = cursor.fetchall()

        items = []
        for row in rows:
            item = {
                "id": int(row.get("id")),
                "entity_type": row.get("entity_type"),
                "entity_id": int(row.get("entity_id") or 0),
                "deleted_by": row.get("deleted_by"),
                "deleted_role": row.get("deleted_role"),
                "reason": row.get("reason"),
                "deleted_at": row.get("deleted_at"),
                "restored_at": row.get("restored_at"),
                "restored_by": row.get("restored_by"),
                "restore_note": row.get("restore_note"),
            }
            if include_payload:
                item["payload"] = json_loads(row.get("payload"))
            items.append(item)

        return jsonify({"items": items, "limit": limit, "offset": offset}), 200
    finally:
        cursor.close()
        db.close()


@system_bp.route("/system/trash/<int:trash_id>/restore", methods=["POST"])
@jwt_required()
def restore_trash_item(trash_id):
    actor_id = current_user_id()
    actor_role = normalize_role(current_user_role())
    if actor_role != ROLE_GLOBAL:
        return jsonify({"error": "Somente GLOBAL pode restaurar registros"}), 403

    data = request.get_json(silent=True) or {}
    restore_note = str(data.get("note") or "").strip()[:255] or None

    db = get_db()
    cursor = db.cursor(dictionary=True)
    try:
        ensure_trash_bin_table(cursor, db)
        ensure_audit_logs_table(cursor, db)
        ensure_operation_comments_table(cursor, db)
        ensure_operation_status_history_table(cursor, db)
        ensure_operation_notifications_table(cursor, db)
        ensure_operations_extra_columns(cursor, db)
        ensure_user_profile_columns(cursor, db)

        twofa_error = require_global_twofa(cursor, actor_id)
        if twofa_error:
            log_audit(
                cursor,
                actor_id=actor_id,
                actor_role=actor_role,
                action="RESTORE_TRASH",
                target_type="TRASH",
                target_id=trash_id,
                success=False,
                reason="2FA invalido",
            )
            db.commit()
            return twofa_error

        cursor.execute(
            """
            SELECT *
            FROM trash_bin
            WHERE id = %s
            LIMIT 1
            """,
            (trash_id,),
        )
        entry = cursor.fetchone()
        if not entry:
            return jsonify({"error": "Registro da lixeira nao encontrado"}), 404
        if entry.get("restored_at") is not None:
            return jsonify({"error": "Registro ja restaurado"}), 409

        payload = json_loads(entry.get("payload")) or {}
        entity_type = normalize_role(entry.get("entity_type"))

        if entity_type == "USUARIO":
            result = restore_user_payload(cursor, payload)
        elif entity_type == "OPERACAO":
            result = restore_operation_payload(cursor, payload)
        elif entity_type == "CLIENTE":
            result = restore_client_payload(cursor, db, payload)
        else:
            return jsonify({"error": "Tipo de entidade nao suportado para restauracao"}), 400

        cursor.execute(
            """
            UPDATE trash_bin
            SET restored_at = NOW(),
                restored_by = %s,
                restore_note = %s
            WHERE id = %s
            """,
            (actor_id, restore_note, trash_id),
        )
        log_audit(
            cursor,
            actor_id=actor_id,
            actor_role=actor_role,
            action="RESTORE_TRASH",
            target_type=entity_type,
            target_id=int(entry.get("entity_id") or 0),
            success=True,
            metadata={"trash_id": int(trash_id), "result": result},
        )
        db.commit()
        return jsonify({"message": "Registro restaurado com sucesso", "trash_id": int(trash_id), "result": result}), 200
    except ValueError as exc:
        db.rollback()
        return jsonify({"error": str(exc)}), 409
    except Exception:
        db.rollback()
        return jsonify({"error": "Nao foi possivel restaurar o registro"}), 500
    finally:
        cursor.close()
        db.close()


@system_bp.route("/system/bulk-delete", methods=["POST"])
@jwt_required()
def bulk_delete():
    actor_id = current_user_id()
    actor_role = normalize_role(current_user_role())
    if actor_role != ROLE_GLOBAL:
        return jsonify({"error": "Somente GLOBAL pode excluir em lote"}), 403

    data = request.get_json(silent=True) or {}
    users_ids = parse_id_list(data.get("users"))
    clients_ids = parse_id_list(data.get("clients"))
    operations_ids = parse_id_list(data.get("operations"))
    reason = str(data.get("reason") or "Exclusao em lote").strip()[:255] or "Exclusao em lote"

    total_requested = len(users_ids) + len(clients_ids) + len(operations_ids)
    if total_requested == 0:
        return jsonify({"error": "Informe ao menos um id para exclusao em lote"}), 400

    confirm_phrase = str(data.get("confirm_phrase") or "").strip().upper()
    try:
        confirm_total = int(data.get("confirm_total") or 0)
    except (TypeError, ValueError):
        confirm_total = -1
    if confirm_phrase != CONFIRM_PHRASE_BULK_DELETE or confirm_total != total_requested:
        return jsonify(
            {
                "error": "Confirmacao em lote invalida",
                "expected": {
                    "confirm_phrase": CONFIRM_PHRASE_BULK_DELETE,
                    "confirm_total": total_requested,
                },
            }
        ), 400

    db = get_db()
    cursor = db.cursor(dictionary=True)
    try:
        ensure_user_profile_columns(cursor, db)
        ensure_operation_comments_table(cursor, db)
        ensure_operation_status_history_table(cursor, db)
        ensure_operation_notifications_table(cursor, db)
        ensure_operations_extra_columns(cursor, db)
        ensure_trash_bin_table(cursor, db)
        ensure_audit_logs_table(cursor, db)

        twofa_error = require_global_twofa(cursor, actor_id)
        if twofa_error:
            log_audit(
                cursor,
                actor_id=actor_id,
                actor_role=actor_role,
                action="BULK_DELETE",
                target_type="SYSTEM",
                success=False,
                reason="2FA invalido",
            )
            db.commit()
            return twofa_error

        results = {"operations": [], "clients": [], "users": []}

        for operation_id in operations_ids:
            try:
                result = delete_operation_record(
                    cursor,
                    operation_id=operation_id,
                    actor_id=actor_id,
                    actor_role=actor_role,
                    reason=reason,
                )
                db.commit()
            except Exception as exc:
                db.rollback()
                result = {"id": int(operation_id), "status": "error", "error": str(exc)}
            results["operations"].append(result)

        for client_id in clients_ids:
            try:
                result = delete_client_record(
                    cursor,
                    db,
                    client_id=client_id,
                    actor_id=actor_id,
                    actor_role=actor_role,
                    reason=reason,
                )
                db.commit()
            except Exception as exc:
                db.rollback()
                result = {"id": int(client_id), "status": "error", "error": str(exc)}
            results["clients"].append(result)

        for user_id in users_ids:
            try:
                result = delete_user_record(
                    cursor,
                    user_id=user_id,
                    actor_id=actor_id,
                    actor_role=actor_role,
                    reason=reason,
                )
                db.commit()
            except Exception as exc:
                db.rollback()
                result = {"id": int(user_id), "status": "error", "error": str(exc)}
            results["users"].append(result)

        summary = {
            "requested": total_requested,
            "deleted": sum(
                1
                for group in results.values()
                for item in group
                if item.get("status") == "deleted"
            ),
            "not_found": sum(
                1
                for group in results.values()
                for item in group
                if item.get("status") == "not_found"
            ),
            "blocked": sum(
                1
                for group in results.values()
                for item in group
                if item.get("status") == "blocked"
            ),
            "errors": sum(
                1
                for group in results.values()
                for item in group
                if item.get("status") == "error"
            ),
        }

        log_audit(
            cursor,
            actor_id=actor_id,
            actor_role=actor_role,
            action="BULK_DELETE",
            target_type="SYSTEM",
            success=summary["errors"] == 0,
            metadata={
                "reason": reason,
                "requested": {
                    "operations": operations_ids,
                    "clients": clients_ids,
                    "users": users_ids,
                },
                "summary": summary,
            },
        )
        db.commit()
        return jsonify({"message": "Exclusao em lote concluida", "summary": summary, "results": results}), 200
    finally:
        cursor.close()
        db.close()


@system_bp.route("/system/audit-logs", methods=["GET"])
@jwt_required()
def list_audit_logs():
    if not actor_is_global():
        return jsonify({"error": "Somente GLOBAL pode acessar auditoria"}), 403

    action = str(request.args.get("action") or "").strip().upper()
    limit = max(1, min(request.args.get("limit", type=int) or 50, 300))
    offset = max(0, request.args.get("offset", type=int) or 0)

    db = get_db()
    cursor = db.cursor(dictionary=True)
    try:
        ensure_audit_logs_table(cursor, db)
        conditions = ["1=1"]
        params = []
        if action:
            conditions.append("action = %s")
            params.append(action)

        where_clause = " AND ".join(conditions)
        cursor.execute(
            f"""
            SELECT
                id,
                actor_id,
                actor_role,
                action,
                target_type,
                target_id,
                success,
                reason,
                metadata,
                ip_address,
                user_agent,
                created_at
            FROM audit_logs
            WHERE {where_clause}
            ORDER BY id DESC
            LIMIT %s OFFSET %s
            """,
            (*params, limit, offset),
        )
        rows = cursor.fetchall()

        items = []
        for row in rows:
            items.append(
                {
                    "id": int(row.get("id")),
                    "actor_id": row.get("actor_id"),
                    "actor_role": row.get("actor_role"),
                    "action": row.get("action"),
                    "target_type": row.get("target_type"),
                    "target_id": row.get("target_id"),
                    "success": bool(row.get("success")),
                    "reason": row.get("reason"),
                    "metadata": json_loads(row.get("metadata")),
                    "ip_address": row.get("ip_address"),
                    "user_agent": row.get("user_agent"),
                    "created_at": row.get("created_at"),
                }
            )

        return jsonify({"items": items, "limit": limit, "offset": offset}), 200
    finally:
        cursor.close()
        db.close()
