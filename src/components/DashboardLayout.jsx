import { Link, Outlet } from "react-router-dom";
import "../pages/Dashboard.css";

export default function DashboardLayout() {
  return (
    <div className="dashboardLayout">
      <aside className="sidebar">
        <div className="userBox">
          <div className="avatar">👤</div>
          <h4>Admin</h4>
          <span>admin@consignado.com</span>
        </div>

        <nav>
          <Link to="/dashboard">🏠 Dashboard</Link>
          <Link to="/clients">👥 Clientes</Link>
          <Link to="/settings">⚙️ Configurações</Link>
          <Link to="/profile">🙍 Meu Perfil</Link>
        </nav>
      </aside>

      <main className="dashboardContent">
        <Outlet />
      </main>
    </div>
  );
}
