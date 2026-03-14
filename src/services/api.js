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

async function parseApiJson(response, fallbackMessage) {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || fallbackMessage);
    }
    return data;
  }

  const rawText = await response.text();
  const compactText = String(rawText || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!response.ok) {
    throw new Error(compactText || fallbackMessage);
  }

  return {};
}

/* =======================
   HEALTH CHECK
======================= */
export async function healthCheck() {
  const response = await fetch(`${API_URL}/health`);
  return parseApiJson(response, "Erro ao listar documentos");
}

export async function updateClient(clientId, clientData) {
  const response = await fetch(`${API_URL}/clients/${clientId}`, {
    method: "PUT",
    headers: getAuthHeaders(true),
    body: JSON.stringify(clientData),
  });

  const data = await response.json();

  if (!response.ok) {
    const details = Array.isArray(data.fields) ? `: ${data.fields.join(", ")}` : "";
    throw new Error((data.error || "Erro ao atualizar cliente") + details);
  }

  return data;
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
      throw new Error((error.error || "Erro ao criar cliente") + suffix + ` (HTTP ${response.status})`);
    }

    const rawText = await response.text();
    const compactText = String(rawText || "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (/<!doctype|<html/i.test(rawText || "")) {
      throw new Error(`Servidor retornou HTML em vez de JSON. Verifique a API. (HTTP ${response.status})`);
    }

    throw new Error((compactText || "Erro ao criar cliente") + ` (HTTP ${response.status})`);
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

  return parseApiJson(response, "Erro ao enviar documentos");
}

export async function searchGlobal(query, limit = 8) {
  const search = String(query || "").trim();
  if (search.length < 2) {
    return { query: search, clients: [] };
  }

  const params = new URLSearchParams({
    q: search,
    limit: String(limit),
  });
  const response = await fetch(`${API_URL}/search/global?${params.toString()}`, {
    headers: getAuthHeaders(),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Erro ao buscar dados");
  }

  return data;
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
export async function downloadDocument(clientId, filename) {
  const safeFilename = String(filename || "").trim() || "documento";
  const response = await fetch(
    `${API_URL}/clients/${clientId}/documents/${encodeURIComponent(safeFilename)}`,
    {
      headers: getAuthHeaders(false),
    }
  );

  if (!response.ok) {
    let errorMessage = "Erro ao baixar documento";
    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const data = await response.json();
      errorMessage = data.error || errorMessage;
    } else {
      const rawText = await response.text();
      const compactText = String(rawText || "")
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (compactText) {
        errorMessage = compactText;
      }
    }

    throw new Error(errorMessage);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = safeFilename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
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
  const safeFilename = String(filename || "").trim();
  const response = await fetch(
    `${API_URL}/clients/${clientId}/documents/${encodeURIComponent(safeFilename)}`,
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

  return parseApiJson(response, "Erro ao excluir documento");
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

  return parseApiJson(response, "Erro ao listar documentos");
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

  return parseApiJson(response, "Erro ao enviar documentos");
}

export async function getPipeline() {
  const response = await fetch(`${API_URL}/operations/pipeline`, {
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Erro ao buscar pipeline");
  }

  return parseApiJson(response, "Erro ao excluir documento");
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

export async function getCurrentUserProfile() {
  const response = await fetch(`${API_URL}/users/me`, {
    headers: getAuthHeaders(),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Erro ao carregar perfil");
  }

  return data.user || data;
}

export async function updateCurrentUserProfile(payload) {
  const response = await fetch(`${API_URL}/users/me`, {
    method: "PUT",
    headers: getAuthHeaders(true),
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Erro ao atualizar perfil");
  }

  return data.user || data;
}

export async function updateCurrentUserPassword(payload) {
  const response = await fetch(`${API_URL}/users/me/password`, {
    method: "PUT",
    headers: getAuthHeaders(true),
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Erro ao atualizar senha");
  }

  return data;
}

export async function createUser(payload) {
  const response = await fetch(`${API_URL}/users`, {
    method: "POST",
    headers: getAuthHeaders(true),
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Erro ao criar usuario");
  }

  return data;
}

export async function listUsers(filters = {}) {
  const params = new URLSearchParams();

  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, String(value));
    }
  });

  const query = params.toString();
  const url = query ? `${API_URL}/users?${query}` : `${API_URL}/users`;
  const response = await fetch(url, {
    headers: getAuthHeaders(),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Erro ao carregar usuarios");
  }

  return data;
}

export async function listCompanies() {
  const response = await fetch(`${API_URL}/companies`, {
    headers: getAuthHeaders(),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Erro ao carregar empresas");
  }

  return data;
}

export async function createCompany(payload) {
  const response = await fetch(`${API_URL}/companies`, {
    method: "POST",
    headers: getAuthHeaders(true),
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Erro ao criar empresa");
  }

  return data;
}

export async function uploadCurrentUserAvatar(file) {
  const formData = new FormData();
  formData.append("avatar", file);

  const response = await fetch(`${API_URL}/users/me/avatar`, {
    method: "POST",
    headers: getAuthHeaders(false),
    body: formData,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Erro ao atualizar foto");
  }

  return data.user || data;
}

export async function deleteCurrentUserAvatar() {
  const response = await fetch(`${API_URL}/users/me/avatar`, {
    method: "DELETE",
    headers: getAuthHeaders(true),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Erro ao remover foto");
  }

  return data.user || data;
}

export async function getUserNotifications(filters = {}) {
  const params = new URLSearchParams();

  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, value);
    }
  });

  const query = params.toString();
  const url = query
    ? `${API_URL}/notifications?${query}`
    : `${API_URL}/notifications`;

  const response = await fetch(url, {
    headers: getAuthHeaders(),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Erro ao carregar notificacoes");
  }

  return data;
}

export async function markNotificationAsRead(notificationId) {
  const response = await fetch(`${API_URL}/notifications/${notificationId}/read`, {
    method: "PUT",
    headers: getAuthHeaders(true),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Erro ao marcar notificacao como lida");
  }

  return data;
}

export async function markAllNotificationsAsRead() {
  const response = await fetch(`${API_URL}/notifications/read-all`, {
    method: "PUT",
    headers: getAuthHeaders(true),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Erro ao marcar notificacoes como lidas");
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

export async function deleteOperation(operationId, twofaCode) {
  const payload = {};
  if (twofaCode) {
    payload.twofa_code = String(twofaCode).trim();
  }

  const response = await fetch(`${API_URL}/operations/${operationId}`, {
    method: "DELETE",
    headers: getAuthHeaders(true),
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Erro ao excluir operacao");
  }

  return data;
}

export async function deleteClient(clientId, twofaCode) {
  const payload = {};
  if (twofaCode) {
    payload.twofa_code = String(twofaCode).trim();
  }

  const response = await fetch(`${API_URL}/clients/${clientId}`, {
    method: "DELETE",
    headers: getAuthHeaders(true),
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Erro ao excluir cliente");
  }

  return data;
}

export async function deleteUser(userId, twofaCode) {
  const payload = {};
  if (twofaCode) {
    payload.twofa_code = String(twofaCode).trim();
  }

  const response = await fetch(`${API_URL}/users/${userId}`, {
    method: "DELETE",
    headers: getAuthHeaders(true),
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Erro ao excluir usuario");
  }

  return data;
}

