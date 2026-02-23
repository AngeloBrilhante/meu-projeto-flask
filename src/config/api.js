const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:5000/api")
  .trim()
  .replace(/\/+$/, "");

export function getApiUrl() {
  return API_URL;
}

export function buildApiUrl(path = "") {
  if (!path) return API_URL;
  return path.startsWith("/") ? `${API_URL}${path}` : `${API_URL}/${path}`;
}

