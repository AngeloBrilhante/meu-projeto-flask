export function getUser() {
  const user = localStorage.getItem("user");
  return user ? JSON.parse(user) : null;
}

export function isAuthenticated() {
  return !!localStorage.getItem("user");
}

export function isAdmin() {
  const user = getUser();
  return user?.role === "ADM";
}

export function logout() {
  localStorage.removeItem("user");
  window.location.href = "/";
}
