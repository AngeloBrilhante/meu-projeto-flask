import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getOperationsReport } from "../services/api";
import {
  DATE_INPUT_PLACEHOLDER,
  formatDateInputValue,
  formatDateTimeDisplayValue,
  normalizeDateInputValue,
} from "../utils/date";
import "./OperationsReport.css";

const INITIAL_FILTERS = {
  status: "",
  vendedor_id: "",
  date_from: "",
  date_to: "",
  search: "",
};

const STATUS_LABELS = {
  APROVADO: "PAGO",
  REPROVADO: "REPROVADO",
};

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

function toCsvValue(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

export default function OperationsReport() {
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [operations, setOperations] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const role = useMemo(() => getStoredRole(), []);
  const isAdmin = role === "ADMIN" || role === "GLOBAL";
  const isVendor = role === "VENDEDOR";
  const routeSearchTerm = useMemo(
    () => String(searchParams.get("search") || "").trim(),
    [searchParams]
  );

  const subtitle = isAdmin
    ? "Pagas e reprovadas de todos os vendedores"
    : isVendor
    ? "Pagas e reprovadas apenas do seu usuario"
    : "Pagas e reprovadas dos produtos permitidos para seu perfil";

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
    const nextFilters = { ...INITIAL_FILTERS, search: routeSearchTerm };
    setFilters(nextFilters);
    loadReport(nextFilters);
  }, [routeSearchTerm]);

  function handleChange(event) {
    const { name, value } = event.target;
    setFilters((prev) => ({
      ...prev,
      [name]:
        name === "date_from" || name === "date_to"
          ? formatDateInputValue(value)
          : value,
    }));
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
      "Valor Liberado",
      "Prazo",
      "Status",
      dateColumnLabel,
    ];

    const rows = operations.map((op) => [
      op.id,
      op.cliente_nome,
      op.cpf,
      op.vendedor_nome,
      op.produto,
      op.banco_digitacao,
      op.valor_liberado,
      op.prazo,
      op.status,
      formatDateTimeDisplayValue(op.status_changed_at || op.criado_em),
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
    const totalValor = operations.reduce((acc, op) => {
      const value = Number(op.valor_liberado);
      return acc + (Number.isFinite(value) ? value : 0);
    }, 0);

    return {
      total: operations.length,
      aprovadas,
      reprovadas,
      totalValor,
    };
  }, [operations]);

  const totalLabel = useMemo(() => {
    if (filters.status === "APROVADO") return "Total pago";
    if (filters.status === "REPROVADO") return "Total recusado";
    return "Total";
  }, [filters.status]);

  const dateColumnLabel = useMemo(() => {
    if (filters.status === "APROVADO") return "Pago em";
    if (filters.status === "REPROVADO") return "Reprovado em";
    return "Data de fechamento";
  }, [filters.status]);

  return (
    <div className="reportContainer">
      <div className="reportHeader">
        <div>
          <h2>Planilha de Operacoes</h2>
          <p>{subtitle}</p>
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
          <option value="APROVADO">Pago</option>
          <option value="REPROVADO">Reprovado</option>
        </select>

        {isAdmin && (
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
        )}

        <input
          type="text"
          name="date_from"
          value={filters.date_from}
          onChange={handleChange}
          inputMode="numeric"
          placeholder={DATE_INPUT_PLACEHOLDER}
        />

        <input
          type="text"
          name="date_to"
          value={filters.date_to}
          onChange={handleChange}
          inputMode="numeric"
          placeholder={DATE_INPUT_PLACEHOLDER}
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
        <div className="statCard">{totalLabel}: {formatCurrency(stats.totalValor)}</div>
        <div className="statCard approved">Pagas: {stats.aprovadas}</div>
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
              <th>Valor liberado</th>
              <th>Prazo</th>
              <th>Status</th>
              <th>{dateColumnLabel}</th>
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
                  <td>{formatCurrency(op.valor_liberado)}</td>
                  <td>{op.prazo}x</td>
                  <td>
                    <span
                      className={`statusBadge ${
                        op.status === "APROVADO" ? "approved" : "rejected"
                      }`}
                    >
                      {STATUS_LABELS[op.status] || op.status}
                    </span>
                  </td>
                  <td>{formatDateTimeDisplayValue(op.status_changed_at || op.criado_em)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
