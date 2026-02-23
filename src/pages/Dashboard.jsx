import { useEffect, useMemo, useState } from "react";
import { getDashboardSummary, updateDashboardGoal } from "../services/api";

function getStoredRole() {
  try {
    const raw = localStorage.getItem("usuario");
    if (!raw) return "";
    const parsed = JSON.parse(raw);
    return (parsed?.role || "").toUpperCase();
  } catch {
    return "";
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

function formatPercent(value) {
  return `${Number(value || 0).toFixed(2)}%`;
}

function formatCurrency(value) {
  const number = Number(value || 0);
  return number.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });
}

function GoalGauge({ percentage }) {
  const normalized = Math.min(Math.max(Number(percentage || 0), 0), 100);

  return (
    <div className="goalGauge">
      <svg viewBox="0 0 240 150" role="img" aria-label="Progresso da meta">
        <path
          d="M20 130 A100 100 0 0 1 220 130"
          pathLength="100"
          className="gaugeTrack"
        />
        <path
          d="M20 130 A100 100 0 0 1 220 130"
          pathLength="100"
          className="gaugeValue"
          style={{ strokeDasharray: `${normalized} 100` }}
        />
      </svg>
      <div className="gaugeCenterValue">{formatPercent(percentage)}</div>
    </div>
  );
}

export default function Dashboard() {
  const [period, setPeriod] = useState(getCurrentPeriod);
  const [vendorId, setVendorId] = useState("");
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingGoal, setSavingGoal] = useState(false);
  const [goalInput, setGoalInput] = useState("");
  const [error, setError] = useState("");

  const role = getStoredRole();
  const isAdmin = role === "ADMIN";

  const periodValues = useMemo(() => toMonthAndYear(period), [period]);

  async function loadSummary() {
    if (!periodValues.month || !periodValues.year) return;

    setLoading(true);
    setError("");

    try {
      const data = await getDashboardSummary({
        month: periodValues.month,
        year: periodValues.year,
        vendedor_id: vendorId || undefined,
      });

      setSummary(data);
      setGoalInput(String(data?.goal?.target || ""));
    } catch (err) {
      setError(err.message || "Erro ao carregar dashboard");
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSummary();
  }, [period, vendorId]);

  async function handleSaveGoal(event) {
    event.preventDefault();

    if (!goalInput) return;

    setSavingGoal(true);
    setError("");

    try {
      await updateDashboardGoal({
        month: periodValues.month,
        year: periodValues.year,
        vendedor_id: vendorId || null,
        target: Number(goalInput),
      });

      await loadSummary();
    } catch (err) {
      setError(err.message || "Nao foi possivel atualizar a meta");
    } finally {
      setSavingGoal(false);
    }
  }

  const operations = summary?.operations || {};
  const progress = summary?.progress || {};
  const vendors = summary?.vendors || [];
  const monthlyApproved = summary?.monthly_approved || [];

  const chartMax = Math.max(
    1,
    ...monthlyApproved.map((item) => Number(item?.approved_value || 0))
  );

  const scopeLabel =
    summary?.scope === "GERAL"
      ? "Desempenho geral de todos os vendedores"
      : "Desempenho individual";

  return (
    <div className="dashboardPage">
      <div className="dashboardHead">
        <div>
          <h1>Dashboard principal</h1>
          <p>{scopeLabel}</p>
        </div>

        <div className="dashboardFilters">
          <label>
            Mes de referencia
            <input
              type="month"
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
            />
          </label>

          {isAdmin && (
            <label>
              Visao
              <select
                value={vendorId}
                onChange={(event) => setVendorId(event.target.value)}
              >
                <option value="">Geral (todos os vendedores)</option>
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.nome}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      {error && <p className="dashboardError">{error}</p>}

      {loading ? (
        <p className="dashboardLoading">Carregando dados...</p>
      ) : (
        <>
          <section className="metricGrid">
            <article className="metricCard">
              <span>Meta mensal em R$</span>
              <strong>{formatCurrency(summary?.goal?.target || 0)}</strong>
              <small>definida pelo admin</small>
            </article>

            <article className="metricCard">
              <span>Operacoes geradas</span>
              <strong>{operations.generated || 0}</strong>
              <small>no mes selecionado</small>
            </article>

            <article className="metricCard">
              <span>Operacoes aprovadas</span>
              <strong>{operations.approved || 0}</strong>
              <small>quantidade no periodo</small>
            </article>

            <article className="metricCard">
              <span>Enviadas para esteira</span>
              <strong>{operations.sent_to_pipeline || 0}</strong>
              <small>em analise + finalizadas</small>
            </article>
          </section>

          <section className="dashboardPanels">
            <article className="panel">
              <h3>Aprovadas por mes</h3>
              <p>Historico anual do valor aprovado.</p>

              <div className="barsChart">
                {monthlyApproved.map((item) => {
                  const approvedValue = Number(item.approved_value || 0);
                  const height = Math.max((approvedValue / chartMax) * 100, 5);

                  return (
                    <div key={item.month} className="barItem">
                      <div className="barTrack">
                        <div
                          className="barValue"
                          style={{ height: `${height}%` }}
                          title={`${item.label}: ${formatCurrency(approvedValue)}`}
                        />
                      </div>
                      <span>{item.label}</span>
                    </div>
                  );
                })}
              </div>
            </article>

            <article className="panel panelGoal">
              <h3>Meta mensal</h3>
              <p>
                Progresso calculado pelas operacoes aprovadas deste periodo.
              </p>

              <GoalGauge percentage={progress.percentage} />

              <div className="goalNumbers">
                <div>
                  <span>Aprovado em R$</span>
                  <strong>{formatCurrency(operations.approved_value || 0)}</strong>
                </div>
                <div>
                  <span>Meta em R$</span>
                  <strong>{formatCurrency(summary?.goal?.target || 0)}</strong>
                </div>
                <div>
                  <span>Falta em R$</span>
                  <strong>{formatCurrency(progress.remaining || 0)}</strong>
                </div>
              </div>

              {isAdmin && (
                <form className="goalForm" onSubmit={handleSaveGoal}>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={goalInput}
                    onChange={(event) => setGoalInput(event.target.value)}
                    placeholder="Nova meta em R$"
                  />
                  <button type="submit" disabled={savingGoal}>
                    {savingGoal ? "Salvando..." : "Salvar meta"}
                  </button>
                </form>
              )}
            </article>
          </section>
        </>
      )}
    </div>
  );
}
