import { useEffect, useMemo, useState } from "react";
import { getSalesDashboard, listCompanies } from "../services/api";
import "./SalesDashboard.css";

function getStoredUser() {
  try {
    const raw = localStorage.getItem("usuario");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getCurrentPeriod() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${now.getFullYear()}-${month}`;
}

function toMonthAndYear(period) {
  const [year, month] = String(period || "").split("-");
  return {
    month: Number(month),
    year: Number(year),
  };
}

function formatCurrency(value) {
  const number = Number(value || 0);
  return number.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });
}

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return `${number.toFixed(1)}%`;
}

function getStatusMeta(row) {
  if (row.status === "ATINGIDA") {
    return { label: "Atingida", className: "success" };
  }

  if (row.status === "ABAIXO") {
    return { label: "Abaixo", className: "warning" };
  }

  return { label: "Sem meta", className: "muted" };
}

export default function SalesDashboard() {
  const storedUser = useMemo(() => getStoredUser(), []);
  const role = String(storedUser?.role || "").toUpperCase();
  const isGlobal = role === "GLOBAL";
  const isAdmin = role === "ADMIN" || isGlobal;

  const [period, setPeriod] = useState(getCurrentPeriod);
  const [companyId, setCompanyId] = useState(
    isGlobal ? String(storedUser?.empresa?.id || "") : ""
  );
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState(null);

  const periodValues = useMemo(() => toMonthAndYear(period), [period]);

  useEffect(() => {
    if (!isGlobal) return undefined;

    let mounted = true;

    async function loadCompanies() {
      try {
        const data = await listCompanies();
        if (!mounted) return;
        setCompanies(Array.isArray(data?.companies) ? data.companies : []);
      } catch {
        if (!mounted) return;
        setCompanies([]);
      }
    }

    loadCompanies();
    return () => {
      mounted = false;
    };
  }, [isGlobal]);

  useEffect(() => {
    if (!isAdmin) return undefined;
    if (!periodValues.month || !periodValues.year) return undefined;

    let mounted = true;

    async function loadBoard() {
      setLoading(true);
      setError("");

      try {
        const data = await getSalesDashboard({
          month: periodValues.month,
          year: periodValues.year,
          empresa_id: isGlobal ? companyId || undefined : undefined,
        });

        if (!mounted) return;
        setSummary(data);
      } catch (err) {
        if (!mounted) return;
        setSummary(null);
        setError(err.message || "Erro ao carregar dashboard comercial");
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadBoard();
    return () => {
      mounted = false;
    };
  }, [companyId, isAdmin, isGlobal, periodValues.month, periodValues.year]);

  const totals = summary?.totals || {};
  const vendors = Array.isArray(summary?.vendors) ? summary.vendors : [];
  const months = Array.isArray(summary?.months) ? summary.months : [];
  const monthlyMatrix = Array.isArray(summary?.monthly_matrix)
    ? summary.monthly_matrix
    : [];
  const selectedMonth = Number(summary?.period?.month || periodValues.month || 0);
  const selectedCompanyName =
    summary?.company?.nome || storedUser?.empresa?.nome || "Todas as empresas";

  if (!isAdmin) {
    return (
      <div className="salesDashboardPage">
        <div className="salesDashboardEmpty">
          <h2>Acesso restrito</h2>
          <p>Essa dashboard comercial fica disponivel apenas para admin e global.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="salesDashboardPage">
      <section className="salesHeroCard">
        <div>
          <span className="salesHeroEyebrow">Dashboard de vendas</span>
          <h1>Visao comercial por meta e realizado</h1>
          <p>
            {summary?.period?.label || "Periodo selecionado"} | Atualizado automaticamente
            a partir das operacoes pagas e metas cadastradas.
          </p>
        </div>

        <div className="salesHeroFilters">
          <label>
            Periodo
            <input
              type="month"
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
            />
          </label>

          {isGlobal && (
            <label>
              Empresa
              <select
                value={companyId}
                onChange={(event) => setCompanyId(event.target.value)}
              >
                <option value="">Todas as empresas</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.nome}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </section>

      {error && <p className="salesDashboardError">{error}</p>}

      {loading ? (
        <div className="salesDashboardEmpty">
          <p>Carregando dashboard comercial...</p>
        </div>
      ) : (
        <>
          <section className="salesSummaryGrid">
            <article className="salesSummaryCard">
              <span>Total realizado</span>
              <strong>{formatCurrency(totals.realized_ytd)}</strong>
              <small>Soma das vendas pagas no periodo acumulado.</small>
            </article>

            <article className="salesSummaryCard accent">
              <span>Total meta</span>
              <strong>{formatCurrency(totals.target_ytd)}</strong>
              <small>Meta acumulada conforme cadastro mensal.</small>
            </article>

            <article className="salesSummaryCard">
              <span>Gap no periodo</span>
              <strong>{formatCurrency(totals.gap_ytd)}</strong>
              <small>Quanto falta para fechar a meta acumulada.</small>
            </article>

            <article className="salesSummaryCard">
              <span>Vendedores ativos</span>
              <strong>{Number(totals.active_vendors || 0)}</strong>
              <small>{selectedCompanyName || "Escopo selecionado"}</small>
            </article>
          </section>

          <section className="salesPanel">
            <div className="salesPanelHeader">
              <div>
                <h2>Metas vs realizado — por vendedor</h2>
                <p>Comparativo do mes selecionado com status visual de atingimento.</p>
              </div>

              <div className="salesPanelHighlight">
                <span>Mes atual</span>
                <strong>{formatCurrency(totals.realized_month)}</strong>
                <small>Meta do mes: {formatCurrency(totals.target_month)}</small>
              </div>
            </div>

            <div className="salesTableWrap">
              <table className="salesTable">
                <thead>
                  <tr>
                    <th>Vendedor</th>
                    {isGlobal && <th>Empresa</th>}
                    <th>Realizado</th>
                    <th>Meta</th>
                    <th>Atingimento</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {vendors.length === 0 ? (
                    <tr>
                      <td colSpan={isGlobal ? 6 : 5}>Sem dados de vendedores para esse periodo.</td>
                    </tr>
                  ) : (
                    vendors.map((row) => {
                      const statusMeta = getStatusMeta(row);
                      return (
                        <tr key={row.vendedor_id}>
                          <td>
                            <strong>{row.vendedor_nome}</strong>
                          </td>
                          {isGlobal && <td>{row.empresa_nome || "-"}</td>}
                          <td>{formatCurrency(row.realized)}</td>
                          <td>{formatCurrency(row.target)}</td>
                          <td>{formatPercent(row.attainment)}</td>
                          <td>
                            <span className={`salesStatusBadge ${statusMeta.className}`}>
                              {statusMeta.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="salesPanel">
            <div className="salesPanelHeader">
              <div>
                <h2>Atingimento mensal (%) — todos os vendedores</h2>
                <p>
                  Percentual por mes com base no valor pago versus a meta daquele
                  vendedor.
                </p>
              </div>
            </div>

            <div className="salesTableWrap">
              <table className="salesTable salesMatrixTable">
                <thead>
                  <tr>
                    <th>Vendedor</th>
                    {isGlobal && <th>Empresa</th>}
                    {months.map((monthItem) => (
                      <th
                        key={monthItem.month}
                        className={monthItem.month > selectedMonth ? "futureCell" : ""}
                      >
                        {monthItem.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {monthlyMatrix.length === 0 ? (
                    <tr>
                      <td colSpan={months.length + (isGlobal ? 2 : 1)}>
                        Sem historico mensal para o periodo selecionado.
                      </td>
                    </tr>
                  ) : (
                    monthlyMatrix.map((vendor) => (
                      <tr key={`matrix-${vendor.vendedor_id}`}>
                        <td>
                          <strong>{vendor.vendedor_nome}</strong>
                        </td>
                        {isGlobal && <td>{vendor.empresa_nome || "-"}</td>}
                        {vendor.months.map((monthItem) => (
                          <td
                            key={`${vendor.vendedor_id}-${monthItem.month}`}
                            className={monthItem.month > selectedMonth ? "futureCell" : ""}
                            title={`Realizado: ${formatCurrency(monthItem.realized)} | Meta: ${formatCurrency(monthItem.target)}`}
                          >
                            {formatPercent(monthItem.attainment)}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
