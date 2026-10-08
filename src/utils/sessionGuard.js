// Quando o backend recusa o token porque a conta entrou em outro computador
// (ou o periodo de acesso acabou), limpa a sessao local e volta para o login.
const SESSION_CODES = new Set(["SESSION_REPLACED", "ACCESS_EXPIRED"]);

let redirecting = false;

export function handleSessionRejection(code) {
  if (!SESSION_CODES.has(code) || redirecting) return false;
  redirecting = true;

  localStorage.removeItem("token");
  localStorage.removeItem("usuario");
  window.location.replace(`/?motivo=${encodeURIComponent(code)}`);
  return true;
}

async function inspectResponse(response) {
  if (response.status !== 401) return;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return;

  try {
    const data = await response.clone().json();
    handleSessionRejection(data?.code);
  } catch {
    // Resposta sem JSON valido: segue o fluxo normal da tela.
  }
}

export function installSessionGuard() {
  if (window.__aureonSessionGuard) return;
  window.__aureonSessionGuard = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    inspectResponse(response);
    return response;
  };
}
