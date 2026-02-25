import { getApiUrl } from "../config/api";

const API_URL = getApiUrl();


// 🔹 PEGA TOKEN REAL
function getAuthHeaders(isJson = true) {
  const token = localStorage.getItem("token");

  return {
    ...(isJson && { "Content-Type": "application/json" }),
    ...(token && { Authorization: `Bearer ${token}` }),
  };
}

/* =======================
   HEALTH CHECK
======================= */
export async function healthCheck() {
  const response = await fetch(`${API_URL}/health`);
  return response.json();
}

/* =======================
   CRIAR CLIENTE
======================= */
export async function createClient(clientData) {
  const response = await fetch(`${API_URL}/clients`, {
    method: "POST",
    headers: getAuthHeaders(true),
    body: JSON.stringify(clientData),
  });

  if (!response.ok) {
    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const error = await response.json();
      const details = Array.isArray(error.fields) ? error.fields : [];
      const suffix = details.length ? `: ${details.join(", ")}` : "";
      throw new Error((error.error || "Erro ao criar cliente") + suffix);
    }

    const rawText = await response.text();
    const compactText = String(rawText || "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (/<!doctype|<html/i.test(rawText || "")) {
      throw new Error("Servidor retornou HTML em vez de JSON. Verifique a API.");
    }

    throw new Error(compactText || "Erro ao criar cliente");
  }

  const data = await response.json();
  return data;
}

/* =======================
   LISTAR CLIENTES
======================= */
export async function listClients() {
  const response = await fetch(`${API_URL}/clients`, {
    headers: getAuthHeaders(),
  });

  return response.json();
}

/* =======================
   LISTAR DOCUMENTOS
======================= */
export async function listClientDocuments(clientId) {
  const response = await fetch(
    `${API_URL}/clients/${clientId}/documents`,
    {
      headers: getAuthHeaders(),
    }
  );

  return response.json();
}

/* =======================
   DOWNLOAD DOCUMENTO
======================= */
export function downloadDocument(clientId, filename) {
  window.open(
    `${API_URL}/clients/${clientId}/documents/${filename}`,
    "_blank"
  );
}

/* =======================
   UPLOAD DOCUMENTOS
======================= */
export async function uploadDocuments(clientId, files) {
  const formData = new FormData();
  formData.append("client_id", clientId);

  Object.entries(files).forEach(([key, file]) => {
    if (file) {
      formData.append(key, file);
    }
  });

  const response = await fetch(`${API_URL}/clients/upload`, {
    method: "POST",
    headers: getAuthHeaders(false), // NÃO definir Content-Type
    body: formData,
  });

  return response.json();
}

/* =======================
   EXCLUIR DOCUMENTO
======================= */
export async function deleteDocument(clientId, filename) {
  const response = await fetch(
    `${API_URL}/clients/${clientId}/documents/${filename}`,
    {
      method: "DELETE",
      headers: getAuthHeaders(),
    }
  );

  return response.json();
}

/* =======================
   BUSCAR CLIENTE POR ID
======================= */
export async function getClientById(clientId) {
  const response = await fetch(
    `${API_URL}/clients/${clientId}`,
    {
      headers: getAuthHeaders(),
    }
  );

  return response.json();
}

/* =======================
   LISTAR OPERAÇÕES
======================= */
export async function listClientOperations(clientId) {
  const response = await fetch(
    `${API_URL}/clients/${clientId}/operations`,
    {
      headers: getAuthHeaders(),
    }
  );

  return response.json();
}

export async function getOperationDossier(operationId) {
  const response = await fetch(`${API_URL}/operations/${operationId}/dossier`, {
    headers: getAuthHeaders(),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Erro ao carregar ficha da operacao");
  }

  return data;
}

/* =======================
   BUSCAR STATUS DO CLIENTE
======================= */
export async function getClientStatus(clientId) {
  const response = await fetch(
    `${API_URL}/clients/${clientId}/status`,
    {
      headers: getAuthHeaders(),
    }
  );

  return response.json();
}

/* =======================
   ATUALIZAR STATUS
======================= */

export async function updateOperation(operationId, data) {
  const response = await fetch(
    `${API_URL}/operations/${operationId}`,
    {
      method: "PUT",
      headers: getAuthHeaders(true),
      body: JSON.stringify(data),
    }
  );

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Erro ao atualizar operacao");
  }

  return payload;
}


/* =======================
   CRIAR OPERAÇÃO
======================= */
export async function createOperation(clientId, operationData) {
  const response = await fetch(
    `${API_URL}/clients/${clientId}/operations`,
    {
      method: "POST",
      headers: getAuthHeaders(true),
      body: JSON.stringify(operationData),
    }
  );

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Erro ao criar operacao");
  }

  return payload;
}

/* =======================
   ENVIAR PARA ESTEIRA
======================= */
export async function sendOperationToPipeline(operationId) {
  const response = await fetch(
    `${API_URL}/operations/${operationId}/send`,
    {
      method: "POST",
      headers: getAuthHeaders(true),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Erro ao enviar operação");
  }

  return data;
}


/* =======================
   ✅ ATUALIZAR STATUS DO CLIENTE (ADICIONADO)
======================= */
export async function updateClientStatus(clientId, status) {
  const response = await fetch(
    `${API_URL}/clients/${clientId}/status`,
    {
      method: "POST",
      headers: getAuthHeaders(true),
      body: JSON.stringify({ status }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Erro ao atualizar status");
  }

  return response.json();
}

export async function getOperationComments(operationId) {
  const response = await fetch(`${API_URL}/operations/${operationId}/comments`, {
    headers: getAuthHeaders(),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Erro ao carregar comentarios");
  }

  return Array.isArray(data) ? data : [];
}

export async function createOperationComment(operationId, message) {
  const response = await fetch(`${API_URL}/operations/${operationId}/comments`, {
    method: "POST",
    headers: getAuthHeaders(true),
    body: JSON.stringify({ message }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Erro ao enviar comentario");
  }

  return data;
}

export async function getOperationStatusHistory(operationId) {
  const response = await fetch(`${API_URL}/operations/${operationId}/status-history`, {
    headers: getAuthHeaders(),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Erro ao carregar historico da operacao");
  }

  return Array.isArray(data) ? data : [];
}

export async function getOperationStats(period) {
  const response = await fetch(
    `${API_URL}/operations/stats?period=${period}`,
    { headers: getAuthHeaders() }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Erro ao buscar estatisticas");
  }

  return response.json();
}

export async function getPipeline() {
  const response = await fetch(`${API_URL}/operations/pipeline`, {
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Erro ao buscar pipeline");
  }

  return response.json();
}

export async function getOperationsReport(filters = {}) {
  const params = new URLSearchParams();

  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, value);
    }
  });

  const query = params.toString();
  const url = query
    ? `${API_URL}/operations/report?${query}`
    : `${API_URL}/operations/report`;

  const response = await fetch(url, {
    headers: getAuthHeaders(),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Erro ao buscar relatorio");
  }

  return data;
}

export async function getDashboardSummary(filters = {}) {
  const params = new URLSearchParams();

  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, value);
    }
  });

  const query = params.toString();
  const url = query
    ? `${API_URL}/dashboard/summary?${query}`
    : `${API_URL}/dashboard/summary`;

  const response = await fetch(url, {
    headers: getAuthHeaders(),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Erro ao carregar dashboard");
  }

  return data;
}

export async function updateDashboardGoal(payload) {
  const response = await fetch(`${API_URL}/dashboard/goal`, {
    method: "PUT",
    headers: getAuthHeaders(true),
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Erro ao atualizar meta");
  }

  return data;
}

export async function getDashboardNotifications() {
  const response = await fetch(`${API_URL}/dashboard/notifications`, {
    headers: getAuthHeaders(),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Erro ao carregar notificacoes");
  }

  return data;
}

