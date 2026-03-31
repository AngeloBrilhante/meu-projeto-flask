import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteClient, getOperationStats, listClients } from "../services/api";
import "./Clients.css";

const LEGACY_STATUS_MAP = {
  PENDENTE: "PRONTA_DIGITAR",
  ENVIADA_ESTEIRA: "PRONTA_DIGITAR",
  FORMALIZADA: "ANALISE_BANCO",
  EM_ANALISE_BANCO: "ANALISE_BANCO",
  PENDENTE_BANCO: "PENDENCIA",
  EM_TRATATIVA_VENDEDOR: "DEVOLVIDA_VENDEDOR",
  REENVIADA_BANCO: "ANALISE_BANCO",
  EM_ANALISE: "ANALISE_BANCO",
  DEVOLVIDA: "DEVOLVIDA_VENDEDOR",
};

const STATUS_LABELS = {
  PRONTA_DIGITAR: "Pronta para digitar",
  EM_DIGITACAO: "Em digitacao",
  AGUARDANDO_FORMALIZACAO: "Aguardando formalizacao",
  ANALISE_BANCO: "Analise do banco",
  PENDENCIA: "Pendencia",
  DEVOLVIDA_VENDEDOR: "Devolvida para vendedor",
  APROVADO: "Paga",
  REPROVADO: "Reprovada",
};

function normalizeStatus(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return LEGACY_STATUS_MAP[normalized] || normalized;
}

function statusLabel(value) {
  if (!value) return "Sem operacao";
  const normalized = normalizeStatus(value);
  return STATUS_LABELS[normalized] || normalized.replaceAll("_", " ");
}

function getStoredRole() {
  try {
    const raw = localStorage.getItem("usuario");
    if (!raw) return "";
    const parsed = JSON.parse(raw);
    return String(parsed?.role || "").toUpperCase();
  } catch {
    return "";
  }
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
  const [removingClientId, setRemovingClientId] = useState(null);

  const navigate = useNavigate();
  const role = getStoredRole();
  const isGlobal = role === "GLOBAL";
  const canCreateClient = role === "GLOBAL" || role === "ADMIN" || role === "VENDEDOR";

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
    } catch {
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

  async function handleDeleteClient(event, client) {
    event.stopPropagation();

    const confirmed = window.confirm(
      `Deseja realmente excluir o cliente ${client.nome || `#${client.id}`}?`
    );
    if (!confirmed) return;

    const twofaCode = window.prompt(
      "Digite o codigo 2FA (6 digitos) para confirmar a exclusao:"
    );
    if (!twofaCode) return;

    try {
      setRemovingClientId(client.id);
      await deleteClient(client.id, twofaCode);
      await fetchClients();
      window.dispatchEvent(new Event("pipeline:changed"));
      alert("Cliente excluido com sucesso.");
    } catch (error) {
      alert(error.message || "Nao foi possivel excluir o cliente.");
    } finally {
      setRemovingClientId(null);
    }
  }

  return (
    <div className="clientsView">
      <div className="clientsHeader">
        <div>
          <h1>Clientes</h1>
          <p>Busca, acompanhamento de esteira e status de operacoes.</p>
        </div>

        {canCreateClient && (
          <button
            type="button"
            className="clientsPrimaryButton"
            onClick={() => navigate("/clients/new")}
          >
            Novo cliente
          </button>
        )}
      </div>

      <div className="clientsStats">
        <label className="clientsPeriodFilter">
          Periodo
          <select value={period} onChange={(event) => setPeriod(event.target.value)}>
            <option value="day">Hoje</option>
            <option value="week">Semana</option>
            <option value="month">Mes</option>
          </select>
        </label>

        <article className="clientsStatCard approved">
          <span>Pagas</span>
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
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>

        <div className="clientsTableWrap">
          <table className="clientsTable">
            <thead>
              <tr>
                <th>Nome</th>
                <th>CPF</th>
                <th>Beneficios</th>
                <th>Ultima operacao</th>
                {isGlobal && <th>Acoes</th>}
              </tr>
            </thead>
            <tbody>
              {filteredClients.map((client) => {
                const status = normalizeStatus(client.last_operation_status || "SEM_OPERACAO");
                const operationCount = Number(client.operation_count) || 0;
                const operationCountLabel =
                  operationCount === 1 ? "1 operacao" : `${operationCount} operacoes`;
                const latestOperationLabel = client.last_operation_id
                  ? `Ultima #${client.last_operation_id}`
                  : "Sem operacao";

                return (
                  <tr
                    key={client.id}
                    onClick={() => navigate(`/clients/${client.id}/documentos`)}
                  >
                    <td>{client.nome}</td>
                    <td>{client.cpf}</td>
                    <td>
                      {Array.isArray(client.beneficios) && client.beneficios.length > 0
                        ? client.beneficios.join(", ")
                        : client.numero_beneficio || "-"}
                    </td>
                    <td>
                      <div className="clientsOperationSummary">
                        <span className={`clientsStatusBadge ${status}`}>
                          {statusLabel(status)}
                        </span>
                        <small>
                          {operationCount > 0
                            ? `${operationCountLabel} • ${latestOperationLabel}`
                            : "Sem operacao cadastrada"}
                        </small>
                      </div>
                    </td>
                    {isGlobal && (
                      <td>
                        <button
                          type="button"
                          className="clientGhostButton"
                          disabled={removingClientId === client.id}
                          onClick={(event) => handleDeleteClient(event, client)}
                        >
                          {removingClientId === client.id ? "Excluindo..." : "Excluir"}
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}

              {filteredClients.length === 0 && (
                <tr>
                  <td colSpan={isGlobal ? 5 : 4} className="clientsEmpty">
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
