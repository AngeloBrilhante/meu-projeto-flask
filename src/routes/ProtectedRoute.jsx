import { Navigate, Outlet } from "react-router-dom";

export default function ProtectedRoute({ children }) {
  const usuario = localStorage.getItem("usuario");

  if (!usuario) {
    return <Navigate to="/" replace />;
  }

  return children ? children : <Outlet />;
}
