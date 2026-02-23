from flask import Blueprint
from controllers.operations_controller import (
    send_to_pipeline,
    update_flow_status,
    update_financial_status,
    get_pipeline
)
from middleware.auth import token_required, role_required

operations_bp = Blueprint("operations", __name__)

# Enviar para esteira (VENDEDOR e ADMIN)
operations_bp.route("/operations/<int:id>/send", methods=["PUT"])(
    token_required(role_required(["VENDEDOR", "ADMIN"])(send_to_pipeline))
)

# Alterar fluxo (ADMIN)
operations_bp.route("/operations/<int:id>/flow", methods=["PUT"])(
    token_required(role_required(["ADMIN"])(update_flow_status))
)

# Alterar financeiro (ADMIN)
operations_bp.route("/operations/<int:id>/financial", methods=["PUT"])(
    token_required(role_required(["ADMIN"])(update_financial_status))
)

# Listar esteira
operations_bp.route("/pipeline", methods=["GET"])(
    token_required(get_pipeline)
)
