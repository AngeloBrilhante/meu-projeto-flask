from flask import request, jsonify
from database.db import get_connection

def send_to_pipeline(id):
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute(
        "UPDATE operacoes SET status_fluxo = 'ENVIADO' WHERE id = %s",
        (id,)
    )

    conn.commit()
    cursor.close()
    conn.close()

    return jsonify({"message": "Operação enviada para esteira"})


def update_flow_status(id):
    data = request.json
    status_fluxo = data.get("status_fluxo")

    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute(
        "UPDATE operacoes SET status_fluxo = %s WHERE id = %s",
        (status_fluxo, id)
    )

    conn.commit()
    cursor.close()
    conn.close()

    return jsonify({"message": "Status de fluxo atualizado"})


def update_financial_status(id):
    data = request.json
    status = data.get("status")

    if status not in ["PAGO", "CANCELADO"]:
        return jsonify({"error": "Status inválido"}), 400

    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute(
        """
        UPDATE operacoes
        SET status = %s,
            data_pagamento = NOW()
        WHERE id = %s
        """,
        (status, id)
    )

    conn.commit()
    cursor.close()
    conn.close()

    return jsonify({"message": "Status financeiro atualizado"})


def get_pipeline():
    conn = get_connection()
    cursor = conn.cursor(dictionary=True)

    cursor.execute(
        "SELECT * FROM operacoes WHERE status_fluxo != 'RASCUNHO'"
    )

    rows = cursor.fetchall()

    cursor.close()
    conn.close()

    return jsonify(rows)
