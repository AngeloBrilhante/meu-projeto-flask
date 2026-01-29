import { Link } from "react-router-dom";

export default function Dashboard() {
  return (
    <>
      <h2>Dashboard</h2>

      <div className="actions">
        <Link to="/clients" className="actionCard">
          👥 Gerenciar Clientes
        </Link>

        <Link to="/clients/new" className="actionCard">
          ➕ Cadastrar Cliente
        </Link>
      </div>
    </>
  );
}
