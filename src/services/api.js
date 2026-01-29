const API_URL = "https://consignado-backend1.onrender.com/api";

/* =======================
   HEALTH CHECK
======================= */
export async function healthCheck() {
  const response = await fetch(`${API_URL}/health`);
  return response.json();
}

/* =======================
   LISTAR DOCUMENTOS
======================= */
export async function listClientDocuments(clientId) {
  const response = await fetch(
    `${API_URL}/clients/${clientId}/documents`,
    {
      headers: {
        Authorization: "Bearer mock-token"
      }
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

  const response = await fetch(
    `${API_URL}/clients/upload`,
    {
      method: "POST",
      headers: {
        Authorization: "Bearer mock-token"
      },
      body: formData
    }
  );

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
      headers: {
        Authorization: "Bearer mock-token"
      }
    }
  );

  return response.json();
}
