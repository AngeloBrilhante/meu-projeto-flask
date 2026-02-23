import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listClients, getOperationStats } from "../services/api";
import "./Clients.css";

function statusLabel(value) {
  if (!value) return "SEM OPERACAO";
  return value.replaceAll("_", " ");
}

export default function Clients() {
  const [clients, setClients] = useState([]);
  const [search, setSearch] = useState("");
  const [stats, setStats] = useState({
    aprovados: 0,
    em_analise: 0,
    reprovados: 0,
  });
  const [period, setPeriod] = useState("day");

  const navigate = useNavigate();

  useEffect(() => {
    fetchClients();
  }, []);

  useEffect(() => {
    fetchStats(period);
  }, [period]);

  async function fetchClients() {
    try {
      const data = await listClients();
      setClients(Array.isArray(data) ? data : []);
    } catch (err) {
      alert(err.message);
    }
  }

  async function fetchStats(selectedPeriod) {
    try {
      const data = await getOperationStats(selectedPeriod);
      setStats(data);
    } catch (err) {
      setStats({
        aprovados: 0,
        em_analise: 0,
        reprovados: 0,
      });
    }
  }

  const filteredClients = clients.filter((client) =>
    Object.values(client)
      .join(" ")
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  return (
    <div className="clientsView">
      <div className="clientsHeader">
        <div>
          <h1>Clientes</h1>
          <p>Busca, acompanhamento de esteira e status de operacoes.</p>
        </div>

        <button
          type="button"
          className="clientsPrimaryButton"
          onClick={() => navigate("/clients/new")}
        >
          Novo cliente
        </button>
      </div>

      <div className="clientsStats">
        <label className="clientsPeriodFilter">
          Periodo
          <select value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="day">Hoje</option>
            <option value="week">Semana</option>
            <option value="month">Mes</option>
          </select>
        </label>

        <article className="clientsStatCard approved">
          <span>Aprovadas</span>
          <strong>{stats.aprovados || 0}</strong>
        </article>

        <article className="clientsStatCard pending">
          <span>Em analise</span>
          <strong>{stats.em_analise || 0}</strong>
        </article>

        <article className="clientsStatCard rejected">
          <span>Reprovadas</span>
          <strong>{stats.reprovados || 0}</strong>
        </article>
      </div>

      <div className="clientsPanel">
        <div className="clientsToolbar">
          <label className="clientsSearch">
            <input
              type="text"
              placeholder="Buscar por nome, CPF, beneficio..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>

        <div className="clientsTableWrap">
          <table className="clientsTable">
            <thead>
              <tr>
                <th>Nome</th>
                <th>CPF</th>
                <th>Beneficio</th>
                <th>Esteira</th>
              </tr>
            </thead>
            <tbody>
              {filteredClients.map((client) => {
                const status = client.last_operation_status || "SEM_OPERACAO";

                return (
                  <tr
                    key={client.id}
                    onClick={() => navigate(`/clients/${client.id}/documentos`)}
                  >
                    <td>{client.nome}</td>
                    <td>{client.cpf}</td>
                    <td>{client.numero_beneficio || "-"}</td>
                    <td>
                      <span className={`clientsStatusBadge ${status}`}>
                        {statusLabel(status)}
                      </span>
                    </td>
                  </tr>
                );
              })}

              {filteredClients.length === 0 && (
                <tr>
                  <td colSpan={4} className="clientsEmpty">
                    Nenhum cliente encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
