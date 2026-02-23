import { getApiUrl } from "../config/api";

const API_URL = getApiUrl();

export async function apiFetch(endpoint, options = {}) {
  const token = localStorage.getItem("token");

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(token && { Authorization: `Bearer ${token}` }),
    },
  });

  if (response.status === 401) {
    localStorage.clear();
    window.location.href = "/login";
    return;
  }

  return response.json();
}
