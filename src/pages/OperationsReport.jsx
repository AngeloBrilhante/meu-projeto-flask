import { useEffect, useMemo, useState } from "react";
import { getOperationsReport } from "../services/api";
import "./OperationsReport.css";

const INITIAL_FILTERS = {
  status: "",
  vendedor_id: "",
  date_from: "",
  date_to: "",
  search: "",
};

function formatCurrency(value) {
  const number = Number(value);

  if (Number.isNaN(number)) {
    return "-";
  }

  return number.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function formatDate(value) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString("pt-BR");
}

function toCsvValue(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

export default function OperationsReport() {
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [operations, setOperations] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadReport(nextFilters = filters) {
    setLoading(true);
    setError("");

    try {
      const data = await getOperationsReport(nextFilters);
      setOperations(Array.isArray(data.operations) ? data.operations : []);
      setVendors(Array.isArray(data.vendors) ? data.vendors : []);
    } catch (err) {
      setError(err.message || "Erro ao carregar relatorio");
      setOperations([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReport(INITIAL_FILTERS);
  }, []);

  function handleChange(event) {
    const { name, value } = event.target;
    setFilters((prev) => ({ ...prev, [name]: value }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    loadReport(filters);
  }

  function handleClear() {
    setFilters(INITIAL_FILTERS);
    loadReport(INITIAL_FILTERS);
  }

  function handleExportCsv() {
    if (!operations.length) return;

    const headers = [
      "ID Operacao",
      "Cliente",
      "CPF",
      "Vendedor",
      "Produto",
      "Banco",
      "Valor Solicitado",
      "Prazo",
      "Status",
      "Criado Em",
    ];

    const rows = operations.map((op) => [
      op.id,
      op.cliente_nome,
      op.cpf,
      op.vendedor_nome,
      op.produto,
      op.banco_digitacao,
      op.valor_solicitado,
      op.prazo,
      op.status,
      formatDate(op.criado_em),
    ]);

    const csvContent = [headers, ...rows]
      .map((row) => row.map(toCsvValue).join(";"))
      .join("\n");

    const blob = new Blob(["\uFEFF" + csvContent], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `relatorio_operacoes_${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const stats = useMemo(() => {
    const aprovadas = operations.filter((op) => op.status === "APROVADO").length;
    const reprovadas = operations.filter((op) => op.status === "REPROVADO").length;

    return {
      total: operations.length,
      aprovadas,
      reprovadas,
    };
  }, [operations]);

  return (
    <div className="reportContainer">
      <div className="reportHeader">
        <div>
          <h2>Planilha de Operacoes</h2>
          <p>Aprovadas e reprovadas de todos os vendedores</p>
        </div>

        <button
          type="button"
          className="exportButton"
          onClick={handleExportCsv}
          disabled={!operations.length}
        >
          Exportar CSV
        </button>
      </div>

      <form className="filtersForm" onSubmit={handleSubmit}>
        <input
          type="text"
          name="search"
          placeholder="Buscar por cliente, CPF, vendedor, produto..."
          value={filters.search}
          onChange={handleChange}
        />

        <select name="status" value={filters.status} onChange={handleChange}>
          <option value="">Todos os status</option>
          <option value="APROVADO">Aprovado</option>
          <option value="REPROVADO">Reprovado</option>
        </select>

        <select
          name="vendedor_id"
          value={filters.vendedor_id}
          onChange={handleChange}
        >
          <option value="">Todos os vendedores</option>
          {vendors.map((vendor) => (
            <option key={vendor.id} value={vendor.id}>
              {vendor.nome}
            </option>
          ))}
        </select>

        <input
          type="date"
          name="date_from"
          value={filters.date_from}
          onChange={handleChange}
        />

        <input
          type="date"
          name="date_to"
          value={filters.date_to}
          onChange={handleChange}
        />

        <button type="submit" className="primaryButton" disabled={loading}>
          {loading ? "Filtrando..." : "Filtrar"}
        </button>

        <button
          type="button"
          className="ghostButton"
          onClick={handleClear}
          disabled={loading}
        >
          Limpar
        </button>
      </form>

      <div className="reportStats">
        <div className="statCard">Total: {stats.total}</div>
        <div className="statCard approved">Aprovadas: {stats.aprovadas}</div>
        <div className="statCard rejected">Reprovadas: {stats.reprovadas}</div>
      </div>

      {error && <p className="errorText">{error}</p>}

      <div className="reportTableWrapper">
        <table className="reportTable">
          <thead>
            <tr>
              <th>ID</th>
              <th>Cliente</th>
              <th>CPF</th>
              <th>Vendedor</th>
              <th>Produto</th>
              <th>Banco</th>
              <th>Valor</th>
              <th>Prazo</th>
              <th>Status</th>
              <th>Criado em</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={10}>Carregando...</td>
              </tr>
            )}

            {!loading && operations.length === 0 && (
              <tr>
                <td colSpan={10}>Nenhuma operacao encontrada.</td>
              </tr>
            )}

            {!loading &&
              operations.map((op) => (
                <tr key={op.id}>
                  <td>{op.id}</td>
                  <td>{op.cliente_nome}</td>
                  <td>{op.cpf}</td>
                  <td>{op.vendedor_nome}</td>
                  <td>{op.produto}</td>
                  <td>{op.banco_digitacao}</td>
                  <td>{formatCurrency(op.valor_solicitado)}</td>
                  <td>{op.prazo}x</td>
                  <td>
                    <span
                      className={`statusBadge ${
                        op.status === "APROVADO" ? "approved" : "rejected"
                      }`}
                    >
                      {op.status}
                    </span>
                  </td>
                  <td>{formatDate(op.criado_em)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
