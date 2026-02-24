import json
import os
import uuid
from datetime import datetime
from flask import Blueprint, request, jsonify, send_from_directory, abort
from flask_jwt_extended import jwt_required, get_jwt, get_jwt_identity
from app.database import get_db
from app.utils.auth import (
    current_user_id,
    current_user_role,
    is_admin,
    can_access_client
)

clients_bp = Blueprint("clients", __name__)

STORAGE_ROOT = os.getenv("STORAGE_ROOT", os.path.join(os.getcwd(), "storage"))
BASE_STORAGE = os.path.join(STORAGE_ROOT, "clients")
ALLOWED_EXTENSIONS = {"pdf", "jpg", "jpeg", "png"}
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


# ======================================================
# UTILITÃRIOS
# ======================================================
def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


PENDING_OPERATION_FIELDS = {
    "produto",
    "banco_digitacao",
    "margem",
    "prazo",
    "valor_solicitado",
    "parcela_solicitada",
    "ficha_portabilidade",
}

PIPELINE_OPERATION_FIELDS = PENDING_OPERATION_FIELDS | {
    "valor_liberado",
    "parcela_liberada",
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

PENDING_BANK_VENDOR_FIELDS = {
    "ficha_portabilidade",
    "pendencia_resposta_vendedor",
    "pendencia_respondida_em",
    "status",
}

FINAL_OPERATION_STATUSES = {"APROVADO", "REPROVADO"}

PIPELINE_ACTIVE_STATUSES = (
    "ENVIADA_ESTEIRA",
    "EM_DIGITACAO",
    "AGUARDANDO_FORMALIZACAO",
    "FORMALIZADA",
    "EM_ANALISE_BANCO",
    "PENDENTE_BANCO",
    "EM_TRATATIVA_VENDEDOR",
    "REENVIADA_BANCO",
)

PIPELINE_ACTIVE_STATUSES_WITH_LEGACY = PIPELINE_ACTIVE_STATUSES + (
    "EM_ANALISE",
    "DEVOLVIDA",
)

VALID_PIPELINE_STATUS_UPDATES = set(PIPELINE_ACTIVE_STATUSES) | FINAL_OPERATION_STATUSES

LEGACY_STATUS_MAP = {
    "EM_ANALISE": "EM_ANALISE_BANCO",
    "DEVOLVIDA": "AGUARDANDO_FORMALIZACAO",
}

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


def normalize_operation_status(status):
    normalized = (status or "").strip().upper()
    return LEGACY_STATUS_MAP.get(normalized, normalized)


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
              'link_formalizacao',
              'devolvida_em',
              'ficha_portabilidade',
              'formalizado_em',
              'pendencia_tipo',
              'pendencia_motivo',
              'pendencia_aberta_em',
              'pendencia_resposta_vendedor',
              'pendencia_respondida_em',
              'motivo_reprovacao'
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


def to_int(value):
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def to_number(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


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
# âž• CRIAR CLIENTE
# ======================================================
@clients_bp.route("/clients", methods=["POST"])
@jwt_required()
def create_client():
    
    print("JWT COMPLETO:", get_jwt())
    print("IDENTITY:", get_jwt_identity())

    data = request.get_json() or {}

    role = (current_user_role() or "").upper()
    user_id = current_user_id()

    print("ROLE EXTRAÃDA:", role)
    print("USER_ID:", user_id)

    if role not in ["ADMIN", "VENDEDOR"]:
        return jsonify({"error": "PermissÃ£o negada"}), 403

    vendedor_id = user_id if role == "VENDEDOR" else data.get("vendedor_id")

    if not vendedor_id:
        return jsonify({"error": "vendedor_id Ã© obrigatÃ³rio"}), 400

    db = get_db()
    cursor = db.cursor()

    cursor.execute(
        """
        INSERT INTO clientes (
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
            cep,
            rua,
            numero,
            bairro,
            criado_em
        ) VALUES (
            %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW()
        )
        """,
        (
            vendedor_id,
            data.get("nome"),
            data.get("cpf"),
            data.get("data_nascimento"),
            data.get("especie"),
            data.get("uf_beneficio"),
            data.get("numero_beneficio"),
            data.get("salario"),
            data.get("nome_mae"),
            data.get("rg_numero"),
            data.get("rg_orgao_exp"),
            data.get("rg_uf"),
            data.get("rg_data_emissao"),
            data.get("naturalidade"),
            data.get("telefone"),
            data.get("cep"),
            data.get("rua"),
            data.get("numero"),
            data.get("bairro"),
        )
    )

    db.commit()
    client_id = cursor.lastrowid

    cursor.close()
    db.close()

    return jsonify({
        "message": "Cliente criado com sucesso",
        "client_id": client_id
    }), 201


# ======================================================
# ðŸ“ƒ CRIAR OPERAÃ‡Ã•ES
# ======================================================

@clients_bp.route("/clients/<int:client_id>/operations", methods=["POST"])
@jwt_required()
def create_operation(client_id):

    if not can_access_client(client_id):
        return jsonify({"error": "Acesso nÃ£o autorizado"}), 403

    data = request.get_json() or {}
    produto = (data.get("produto") or "").strip().upper()
    ficha_portabilidade = None

    if produto in {"PORTABILIDADE", "PORTABILIDADE_REFIN"} or "ficha_portabilidade" in data:
        ficha_portabilidade = serialize_portability_form(data.get("ficha_portabilidade"))

    db = get_db()
    cursor = db.cursor(dictionary=True)
    ensure_operations_extra_columns(cursor, db)

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
        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'PENDENTE', NOW())
    """, (
        client_id,
        produto,
        data.get("banco_digitacao"),
        data.get("margem"),
        data.get("prazo"),
        data.get("valor_solicitado"),
        data.get("parcela_solicitada"),
        ficha_portabilidade,
    ))

    db.commit()
    operation_id = cursor.lastrowid

    cursor.close()
    db.close()

    return jsonify({
        "message": "OperaÃ§Ã£o criada com sucesso",
        "operation_id": operation_id
    }), 201


# ======================================================
# ðŸ“ƒ LISTAR CLIENTES
# ======================================================
@clients_bp.route("/clients", methods=["GET"])
@jwt_required()
def list_clients():
    db = get_db()
    cursor = db.cursor(dictionary=True)

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

    cursor.close()
    db.close()

    return jsonify(clients), 200



# ======================================================
# ðŸ“ƒ LISTAR CONTRATOS DE CLIENTES
# ======================================================

@clients_bp.route("/clients/<int:client_id>/operations", methods=["GET"])
@jwt_required()
def list_operations(client_id):

    if not can_access_client(client_id):
        return jsonify({"error": "Acesso nÃ£o autorizado"}), 403

    db = get_db()
    cursor = db.cursor(dictionary=True)

    cursor.execute("""
        SELECT * FROM operacoes
        WHERE cliente_id=%s
        ORDER BY criado_em DESC
    """, (client_id,))

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

    if role not in {"ADMIN", "VENDEDOR"}:
        return jsonify({"error": "Acesso nao autorizado"}), 403

    db = get_db()
    cursor = db.cursor(dictionary=True)
    ensure_operations_extra_columns(cursor, db)

    cursor.execute(
        """
        SELECT
            o.*,
            c.id AS cliente_id,
            c.vendedor_id,
            COALESCE(u.nome, '-') AS vendedor_nome
        FROM operacoes o
        JOIN clientes c ON c.id = o.cliente_id
        LEFT JOIN usuarios u ON u.id = c.vendedor_id
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

    if role != "ADMIN" and operation.get("vendedor_id") != user_id:
        return jsonify({"error": "Acesso nao autorizado"}), 403

    operation = hydrate_operation_payload(operation)

    client_folder = os.path.join(BASE_STORAGE, str(operation.get("cliente_id")))
    documents = []

    if os.path.exists(client_folder):
        for filename in os.listdir(client_folder):
            file_path = os.path.join(client_folder, filename)
            documents.append(
                {
                    "filename": filename,
                    "type": filename.split("_")[0].upper(),
                    "uploaded_at": datetime.fromtimestamp(
                        os.path.getctime(file_path)
                    ).strftime("%Y-%m-%d %H:%M:%S"),
                }
            )

        documents.sort(key=lambda item: item.get("uploaded_at", ""), reverse=True)

    return jsonify({"operation": operation, "documents": documents}), 200


# ======================================================
# COMENTARIOS DA OPERACAO
# ======================================================
@clients_bp.route("/operations/<int:operation_id>/comments", methods=["GET"])
@jwt_required()
def list_operation_comments(operation_id):
    role = normalize_role(current_user_role())
    user_id = current_user_id()

    if role not in {"ADMIN", "VENDEDOR"}:
        return jsonify({"error": "Acesso nao autorizado"}), 403

    db = get_db()
    cursor = db.cursor(dictionary=True)
    ensure_operation_comments_table(cursor, db)

    cursor.execute(
        """
        SELECT
            o.id,
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

    if role != "ADMIN" and operation.get("vendedor_id") != user_id:
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

    if role not in {"ADMIN", "VENDEDOR"}:
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

    cursor.execute(
        """
        SELECT
            o.id,
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

    if role != "ADMIN" and operation.get("vendedor_id") != user_id:
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
    db.commit()
    comment_id = cursor.lastrowid

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


# ðŸ“„ OBTER CLIENTE POR ID
# ======================================================
@clients_bp.route("/clients/<int:client_id>", methods=["GET"])
@jwt_required()
def get_client(client_id):
    if not can_access_client(client_id):
        return jsonify({"error": "Acesso nÃ£o autorizado"}), 403

    db = get_db()
    cursor = db.cursor(dictionary=True)

    cursor.execute(
        "SELECT * FROM clientes WHERE id = %s",
        (client_id,)
    )

    client = cursor.fetchone()

    cursor.close()
    db.close()

    if not client:
        return jsonify({"error": "Cliente nÃ£o encontrado"}), 404

    return jsonify(client), 200



# ======================================================
# ðŸ“¤ UPLOAD DE DOCUMENTOS
# ======================================================
@clients_bp.route("/clients/upload", methods=["POST", "OPTIONS"])
@jwt_required(optional=True)
def upload_document():
    if request.method == "OPTIONS":
        return "", 200

    client_id = request.form.get("client_id")

    if not client_id:
        return jsonify({"error": "client_id Ã© obrigatÃ³rio"}), 400

    if not can_access_client(int(client_id)):
        return jsonify({"error": "Acesso nÃ£o autorizado"}), 403

    if not request.files:
        return jsonify({"error": "Nenhum arquivo enviado"}), 400

    client_folder = os.path.join(BASE_STORAGE, str(client_id))
    os.makedirs(client_folder, exist_ok=True)

    saved_files = {}

    for field_name, file in request.files.items():
        if file and allowed_file(file.filename):
            ext = file.filename.rsplit(".", 1)[1].lower()
            filename = f"{field_name}_{uuid.uuid4().hex}.{ext}"
            file.save(os.path.join(client_folder, filename))
            saved_files[field_name] = filename

    if not saved_files:
        return jsonify({"error": "Nenhum arquivo vÃ¡lido enviado"}), 400

    return jsonify({
        "message": "Arquivos enviados com sucesso",
        "files": saved_files
    }), 201


# ======================================================
# ðŸ“ƒ LISTAR DOCUMENTOS
# ======================================================
@clients_bp.route("/clients/<int:client_id>/documents", methods=["GET", "OPTIONS"])
@jwt_required(optional=True)
def list_documents(client_id):
    if request.method == "OPTIONS":
        return "", 200

    if not can_access_client(client_id):
        return jsonify({"error": "Acesso nÃ£o autorizado"}), 403

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
# ðŸ“¥ DOWNLOAD DOCUMENTO
# ======================================================
@clients_bp.route(
    "/clients/<int:client_id>/documents/<filename>",
    methods=["GET", "OPTIONS"]
)
@jwt_required(optional=True)
def download_document(client_id, filename):
    if request.method == "OPTIONS":
        return "", 200

    if not can_access_client(client_id):
        return jsonify({"error": "Acesso nÃ£o autorizado"}), 403

    client_folder = os.path.join(BASE_STORAGE, str(client_id))
    file_path = os.path.join(client_folder, filename)

    if not os.path.exists(file_path):
        abort(404, description="Arquivo nÃ£o encontrado")

    return send_from_directory(
        client_folder,
        filename,
        as_attachment=True
    )


# ======================================================
# ðŸ—‘ï¸ EXCLUIR DOCUMENTO
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
        return jsonify({"error": "Acesso nÃ£o autorizado"}), 403

    client_folder = os.path.join(BASE_STORAGE, str(client_id))
    file_path = os.path.join(client_folder, filename)

    if not os.path.exists(file_path):
        return jsonify({"error": "Arquivo nÃ£o encontrado"}), 404

    os.remove(file_path)

    return jsonify({
        "message": "Documento excluÃ­do com sucesso",
        "filename": filename
    }), 200


# ======================================================
# ðŸ“„ ADMIN ATUALIZA STATUS
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

    if "ficha_portabilidade" in data:
        data["ficha_portabilidade"] = serialize_portability_form(
            data.get("ficha_portabilidade")
        )

    cursor.execute(
        """
        SELECT
            o.id,
            o.status,
            o.pendencia_resposta_vendedor,
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
    allowed_fields = set()

    if role == "VENDEDOR":
        if operation.get("vendedor_id") != user_id:
            cursor.close()
            db.close()
            return jsonify({"error": "Voce nao pode editar essa operacao"}), 403

        if current_status == "PENDENTE":
            if "status" in data:
                next_status = normalize_operation_status(data.get("status"))
                if next_status != "PENDENTE":
                    cursor.close()
                    db.close()
                    return jsonify({
                        "error": "Para enviar para esteira, use o botao de envio"
                    }), 400
                data["status"] = "PENDENTE"

            allowed_fields = PENDING_OPERATION_FIELDS

        elif current_status in {"PENDENTE_BANCO", "EM_TRATATIVA_VENDEDOR"}:
            if "status" in data:
                next_status = normalize_operation_status(data.get("status"))
                if next_status != "EM_TRATATIVA_VENDEDOR":
                    cursor.close()
                    db.close()
                    return jsonify({
                        "error": "Vendedor pode somente registrar tratativa da pendencia"
                    }), 400
                data["status"] = next_status
            else:
                data["status"] = "EM_TRATATIVA_VENDEDOR"

            response_text = str(data.get("pendencia_resposta_vendedor") or "").strip()
            if not response_text:
                response_text = str(
                    operation.get("pendencia_resposta_vendedor") or ""
                ).strip()

            if not response_text:
                cursor.close()
                db.close()
                return jsonify({
                    "error": "Informe a resposta da pendencia antes de reenviar"
                }), 400

            data["pendencia_resposta_vendedor"] = response_text
            data["pendencia_respondida_em"] = now_str
            allowed_fields = PENDING_BANK_VENDOR_FIELDS

        else:
            cursor.close()
            db.close()
            return jsonify({
                "error": "Sem permissao para editar operacao neste status"
            }), 403

    elif role == "ADMIN":
        if current_status in FINAL_OPERATION_STATUSES:
            cursor.close()
            db.close()
            return jsonify({
                "error": "Operacao finalizada. Nao e possivel editar."
            }), 400

        if current_status == "PENDENTE":
            if "status" in data:
                next_status = normalize_operation_status(data.get("status"))
                if next_status != "PENDENTE":
                    cursor.close()
                    db.close()
                    return jsonify({
                        "error": "Para enviar para esteira, use o botao de envio"
                    }), 400
                data["status"] = "PENDENTE"

            allowed_fields = PENDING_OPERATION_FIELDS
        else:
            allowed_fields = PIPELINE_OPERATION_FIELDS

            if "status" in data:
                next_status = normalize_operation_status(data.get("status"))
                if next_status not in VALID_PIPELINE_STATUS_UPDATES:
                    cursor.close()
                    db.close()
                    return jsonify({"error": "Status invalido para a esteira"}), 400

                data["status"] = next_status

                if next_status == "AGUARDANDO_FORMALIZACAO":
                    link = str(data.get("link_formalizacao") or "").strip()
                    if not link:
                        cursor.close()
                        db.close()
                        return jsonify({
                            "error": "Informe o link_formalizacao para devolver ao vendedor"
                        }), 400
                    data["link_formalizacao"] = link
                    data["devolvida_em"] = now_str

                if next_status == "FORMALIZADA" and "formalizado_em" not in data:
                    data["formalizado_em"] = now_str

                if next_status == "PENDENTE_BANCO":
                    reason = str(data.get("pendencia_motivo") or "").strip()
                    if not reason:
                        cursor.close()
                        db.close()
                        return jsonify({
                            "error": "Informe o motivo da pendencia para o vendedor"
                        }), 400
                    data["pendencia_motivo"] = reason
                    data["pendencia_aberta_em"] = now_str

                if next_status == "APROVADO" and "data_pagamento" not in data:
                    data["data_pagamento"] = now_str

                if next_status == "REPROVADO":
                    rejected_reason = str(data.get("motivo_reprovacao") or "").strip()
                    if not rejected_reason:
                        cursor.close()
                        db.close()
                        return jsonify({"error": "Informe o motivo da reprovaÃ§Ã£o"}), 400
                    data["motivo_reprovacao"] = rejected_reason

            if "link_formalizacao" in data and data.get("link_formalizacao") is not None:
                data["link_formalizacao"] = str(data.get("link_formalizacao") or "").strip()

            if "pendencia_tipo" in data and data.get("pendencia_tipo") is not None:
                data["pendencia_tipo"] = str(data.get("pendencia_tipo") or "").strip().upper()

            if "pendencia_motivo" in data and data.get("pendencia_motivo") is not None:
                data["pendencia_motivo"] = str(data.get("pendencia_motivo") or "").strip()

            if (
                "pendencia_resposta_vendedor" in data
                and data.get("pendencia_resposta_vendedor") is not None
            ):
                reply = str(data.get("pendencia_resposta_vendedor") or "").strip()
                data["pendencia_resposta_vendedor"] = reply
                if reply and "pendencia_respondida_em" not in data:
                    data["pendencia_respondida_em"] = now_str

            if "motivo_reprovacao" in data and data.get("motivo_reprovacao") is not None:
                data["motivo_reprovacao"] = str(data.get("motivo_reprovacao") or "").strip()

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
# ðŸ“„ ENVIAR OPERAÃ‡ÃƒO PARA ESTEIRA
# ======================================================

@clients_bp.route("/operations/<int:operation_id>/send", methods=["POST"])
@jwt_required()
def send_operation_to_pipeline(operation_id):
    conn = None
    cursor = None

    try:
        role = normalize_role(current_user_role())
        user_id = current_user_id()

        if not role:
            return jsonify({"error": "Usuario invalido"}), 403

        conn = get_db()
        cursor = conn.cursor(dictionary=True)
        ensure_operations_extra_columns(cursor, conn)

        cursor.execute(
            """
            SELECT
                o.id,
                o.status,
                o.pendencia_resposta_vendedor,
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

        if role == "VENDEDOR" and operation.get("vendedor_id") != user_id:
            return jsonify({"error": "Voce nao pode enviar essa operacao"}), 403

        current_status = normalize_operation_status(operation.get("status"))
        next_status = None

        if current_status in FINAL_OPERATION_STATUSES:
            return jsonify({
                "error": "Operacao finalizada nao pode voltar para esteira"
            }), 400

        if current_status == "PENDENTE":
            next_status = "ENVIADA_ESTEIRA"
        elif current_status in {"PENDENTE_BANCO", "EM_TRATATIVA_VENDEDOR"}:
            response_text = str(
                operation.get("pendencia_resposta_vendedor") or ""
            ).strip()
            if not response_text:
                return jsonify({
                    "error": "Informe a resposta da pendencia antes de reenviar"
                }), 400
            next_status = "REENVIADA_BANCO"

        if not next_status and current_status in PIPELINE_ACTIVE_STATUSES_WITH_LEGACY:
            return jsonify({"error": "Operacao ja esta na esteira"}), 400

        if not next_status:
            return jsonify({"error": "Status da operacao invalido para envio"}), 400

        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        updates = ["status=%s"]
        params = [next_status]

        if next_status == "REENVIADA_BANCO":
            updates.append("devolvida_em=NULL")
            updates.append(
                "pendencia_respondida_em=COALESCE(pendencia_respondida_em, %s)"
            )
            params.append(now_str)

        params.append(operation_id)
        cursor.execute(
            f"UPDATE operacoes SET {', '.join(updates)} WHERE id=%s",
            tuple(params),
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
# ðŸ“„ ADMIN FASE COMERCIAL
# ======================================================


@clients_bp.route("/clients/<int:client_id>/fase", methods=["PUT"])
@jwt_required()
def update_client_fase(client_id):

    if not is_admin():
        return jsonify({
            "error": "Somente ADMIN pode alterar fase"
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
# ðŸ“„ ADMIN - LISTAR ESTEIRA
# ======================================================

@clients_bp.route("/operations/pipeline", methods=["GET"])
@jwt_required()
def get_pipeline():

    if not is_admin():
        return jsonify({"error": "Acesso restrito"}), 403

    db = get_db()
    cursor = db.cursor(dictionary=True)
    ensure_operations_extra_columns(cursor, db)

    status_placeholders = ", ".join(["%s"] * len(PIPELINE_ACTIVE_STATUSES_WITH_LEGACY))
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
            o.criado_em,
            c.id as cliente_id,
            c.nome,
            c.cpf,
            c.vendedor_id,
            COALESCE(u.nome, '-') AS vendedor_nome
        FROM operacoes o
        JOIN clientes c ON c.id = o.cliente_id
        LEFT JOIN usuarios u ON u.id = c.vendedor_id
        WHERE o.status IN ({status_placeholders})
        ORDER BY o.criado_em ASC
    """, tuple(PIPELINE_ACTIVE_STATUSES_WITH_LEGACY))

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
# ðŸ“Š ADMIN - RELATÃ“RIO DE OPERAÃ‡Ã•ES FINALIZADAS
# ======================================================

@clients_bp.route("/operations/report", methods=["GET"])
@jwt_required()
def get_operations_report():

    if not is_admin():
        return jsonify({"error": "Acesso restrito"}), 403

    status = (request.args.get("status") or "").strip().upper()
    vendedor_id = request.args.get("vendedor_id", type=int)
    date_from = (request.args.get("date_from") or "").strip()
    date_to = (request.args.get("date_to") or "").strip()
    search = (request.args.get("search") or "").strip()

    allowed_status = {"APROVADO", "REPROVADO"}

    if status and status not in allowed_status:
        return jsonify({"error": "status invÃ¡lido"}), 400

    parsed_from = None
    parsed_to = None

    try:
        if date_from:
            parsed_from = datetime.strptime(date_from, "%Y-%m-%d")
        if date_to:
            parsed_to = datetime.strptime(date_to, "%Y-%m-%d")
    except ValueError:
        return jsonify({"error": "Formato de data invÃ¡lido. Use YYYY-MM-DD."}), 400

    if parsed_from and parsed_to and parsed_from > parsed_to:
        return jsonify({"error": "date_from nÃ£o pode ser maior que date_to"}), 400

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
            o.valor_solicitado,
            o.parcela_solicitada,
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
# ðŸ“Š ADMIN - ESTATÃSTICAS DA ESTEIRA
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
        return jsonify({"error": "PerÃ­odo invÃ¡lido"}), 400

    active_status_placeholders = ", ".join(
        ["%s"] * len(PIPELINE_ACTIVE_STATUSES_WITH_LEGACY)
    )
    cursor.execute(
        f"""
        SELECT
            SUM(CASE WHEN o.status='APROVADO' THEN 1 ELSE 0 END) as aprovados,
            SUM(
                CASE
                    WHEN o.status IN ({active_status_placeholders}) THEN 1
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
    selected_vendor_id = requested_vendor_id if role == "ADMIN" else current_user_id()

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        ensure_dashboard_goals_table(cursor, db)

        sent_statuses = PIPELINE_ACTIVE_STATUSES_WITH_LEGACY + (
            "APROVADO",
            "REPROVADO",
        )
        sent_status_placeholders = ", ".join(["%s"] * len(sent_statuses))

        stats_params = list(sent_statuses) + [period_start, period_end]
        vendor_clause = ""

        if selected_vendor_id:
            vendor_clause = " AND c.vendedor_id = %s"
            stats_params.append(selected_vendor_id)

        cursor.execute(
            f"""
            SELECT
                COUNT(*) AS generated_operations,
                SUM(
                    CASE
                        WHEN o.status IN ({sent_status_placeholders}) THEN 1
                        ELSE 0
                    END
                ) AS sent_to_pipeline
            FROM operacoes o
            JOIN clientes c ON c.id = o.cliente_id
            WHERE o.criado_em >= %s
              AND o.criado_em < %s
              {vendor_clause}
            """,
            tuple(stats_params),
        )
        stats_row = cursor.fetchone() or {}

        approved_params = [period_start, period_end]
        approved_vendor_clause = ""

        if selected_vendor_id:
            approved_vendor_clause = " AND c.vendedor_id = %s"
            approved_params.append(selected_vendor_id)

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

        cursor.execute(
            f"""
            SELECT COUNT(*) AS in_pipeline
            FROM operacoes o
            JOIN clientes c ON c.id = o.cliente_id
            WHERE o.status IN ({pipeline_status_placeholders})
              {pipeline_vendor_clause}
            """,
            tuple(pipeline_params),
        )
        pipeline_row = cursor.fetchone() or {}

        series_params = [year]
        series_vendor_clause = ""

        if selected_vendor_id:
            series_vendor_clause = " AND c.vendedor_id = %s"
            series_params.append(selected_vendor_id)

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

        vendors = []
        if role == "ADMIN":
            cursor.execute(
                """
                SELECT id, nome
                FROM usuarios
                WHERE UPPER(role) = 'VENDEDOR'
                ORDER BY nome ASC
                """
            )
            vendors = cursor.fetchall()

        selected_vendor = None
        if selected_vendor_id:
            cursor.execute(
                """
                SELECT id, nome
                FROM usuarios
                WHERE id = %s
                LIMIT 1
                """,
                (selected_vendor_id,),
            )
            selected_vendor = cursor.fetchone()

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

        return jsonify(
            {
                "scope": (
                    "GERAL"
                    if role == "ADMIN" and not selected_vendor_id
                    else "INDIVIDUAL"
                ),
                "period": {
                    "month": month,
                    "year": year,
                },
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
                "monthly_approved": monthly_approved,
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
        return jsonify({"error": "Somente ADMIN pode alterar a meta"}), 403

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
# DASHBOARD - NOTIFICACOES DO SINO
# ======================================================

@clients_bp.route("/dashboard/notifications", methods=["GET"])
@jwt_required()
def get_dashboard_notifications():
    role = normalize_role(current_user_role())
    vendor_id = None if role == "ADMIN" else current_user_id()

    db = get_db()
    cursor = db.cursor(dictionary=True)

    try:
        active_status_placeholders = ", ".join(
            ["%s"] * len(PIPELINE_ACTIVE_STATUSES_WITH_LEGACY)
        )
        params = list(PIPELINE_ACTIVE_STATUSES_WITH_LEGACY)
        vendor_clause = ""

        if vendor_id:
            vendor_clause = " AND c.vendedor_id = %s"
            params.append(vendor_id)

        cursor.execute(
            f"""
            SELECT COUNT(*) AS pipeline_count
            FROM operacoes o
            JOIN clientes c ON c.id = o.cliente_id
            WHERE o.status IN ({active_status_placeholders})
              {vendor_clause}
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
    finally:
        cursor.close()
        db.close()

