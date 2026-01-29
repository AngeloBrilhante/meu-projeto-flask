import "./Clients.css";
import ClientsList from "./ClientsList";
import { Link } from "react-router-dom";

export default function Clients() {
  return (
    <div className="clientsPage">
      <div className="clientsHeader">
        <h2>Clientes</h2>

        <Link to="/clients/new">
          <button className="btnNewClient">➕ Novo Cliente</button>
        </Link>
      </div>

      <ClientsList />
    </div>
  );
}
