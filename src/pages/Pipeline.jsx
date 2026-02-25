import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getOperationStatusHistory,
  getPipeline,
  updateOperation,
} from "../services/api";
import "./Pipeline.css";

const STATUS_LABELS = {
  PRONTA_DIGITAR: "Pronta para digitar",
  EM_DIGITACAO: "Em digitacao",
  AGUARDANDO_FORMALIZACAO: "Aguardando formalizacao",
  ANALISE_BANCO: "Analise do banco",
  PENDENCIA: "Pendencia",
  DEVOLVIDA_VENDEDOR: "Devolvida para vendedor",
  APROVADO: "Aprovada",
  REPROVADO: "Reprovada",
};

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

const PENDENCIA_TYPE_OPTIONS = [
  { value: "", label: "Tipo de pendencia" },
  { value: "DOCUMENTACAO", label: "Documentacao" },
  { value: "ASSINATURA", label: "Assinatura" },
  { value: "MARGEM", label: "Margem" },
  { value: "DIVERGENCIA_CADASTRAL", label: "Divergencia cadastral" },
  { value: "OUTROS", label: "Outros" },
];

const REPROVACAO_REASON_OPTIONS = [
  { value: "", label: "Selecione o motivo da reprovacao" },
  { value: "MARGEM_INSUFICIENTE", label: "Margem insuficiente" },
  { value: "DOCUMENTACAO_INVALIDA", label: "Documentacao invalida" },
  { value: "DIVERGENCIA_CADASTRAL", label: "Divergencia cadastral" },
  { value: "POLITICA_BANCO", label: "Politica do banco" },
  { value: "DESISTENCIA_CLIENTE", label: "Desistencia do cliente" },
  { value: "OUTROS", label: "Outros" },
];

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function normalizeStatus(status) {
  const normalized = String(status || "").trim().toUpperCase();
  return LEGACY_STATUS_MAP[normalized] || normalized;
}

function getStatusLabel(status) {
  const normalized = normalizeStatus(status);
  return STATUS_LABELS[normalized] || normalized || "-";
}

function toDraft(operation) {
  return {
    link_formalizacao: operation.link_formalizacao || "",
    pendencia_tipo: operation.pendencia_tipo || "",
    pendencia_motivo: operation.pendencia_motivo || "",
    motivo_reprovacao: operation.motivo_reprovacao || "",
    reprovacao_tipo: "",
  };
}

function toTimestamp(value) {
  const time = new Date(value || "").getTime();
  return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
}

function getPriorityMeta(createdAt, nowMs) {
  const createdMs = toTimestamp(createdAt);

  if (createdMs === Number.MAX_SAFE_INTEGER) {
    return {
      label: "-",
      tone: "green",
      createdMs,
    };
  }

  const elapsedMs = Math.max(0, nowMs - createdMs);
  const elapsedHours = elapsedMs / (60 * 60 * 1000);
  const elapsedMinutes = elapsedMs / (60 * 1000);
  let tone = "green";

  if (elapsedMs >= ONE_DAY_MS) {
    tone = "red";
  } else if (elapsedMs >= FIVE_HOURS_MS) {
    tone = "yellow";
  }

  let label = `${Math.max(1, Math.floor(elapsedMinutes))}m`;

  if (elapsedHours >= 24) {
    label = `${Math.floor(elapsedHours / 24)}d`;
  } else if (elapsedHours >= 1) {
    label = `${Math.floor(elapsedHours)}h`;
  }

  return {
    label,
    tone,
    createdMs,
  };
}

function formatDateTime(value) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleString("pt-BR");
}

function formatHistoryTransition(item) {
  const nextLabel = getStatusLabel(item.next_status);

  if (!item.previous_status) {
    return nextLabel;
  }

  const previousLabel = getStatusLabel(item.previous_status);

  if (previousLabel === nextLabel) {
    return nextLabel;
  }

  return `${previousLabel} -> ${nextLabel}`;
}

function formatHistoryActor(item) {
  const name = String(item.changed_by_name || "").trim();
  const role = String(item.changed_by_role || "").trim().toUpperCase();
  const base = name && name !== "-" ? name : "Sistema";
  return role ? `${base} (${role})` : base;
}

export default function Pipeline() {
  const navigate = useNavigate();
  const [operations, setOperations] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(false);
  const [savingOperationId, setSavingOperationId] = useState(null);
  const [openEditors, setOpenEditors] = useState({});
  const [openHistory, setOpenHistory] = useState({});
  const [historyByOperation, setHistoryByOperation] = useState({});
  const [loadingHistoryOperationId, setLoadingHistoryOperationId] = useState(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const openEditorsRef = useRef({});

  useEffect(() => {
    openEditorsRef.current = openEditors;
  }, [openEditors]);

  async function fetchPipeline() {
    try {
      setLoading(true);
      const data = await getPipeline();
      const list = Array.isArray(data) ? data : [];
      setNowMs(Date.now());

      setOperations(list);
      setDrafts((prev) => {
        const next = {};

        list.forEach((operation) => {
          const serverDraft = toDraft(operation);
          const editors = openEditorsRef.current[operation.id] || {};
          const keepLocalDraft = Boolean(editors.pendencia || editors.reprovacao);

          next[operation.id] = keepLocalDraft
            ? { ...serverDraft, ...(prev[operation.id] || {}) }
            : serverDraft;
        });

        return next;
      });
    } catch (error) {
      console.error("Erro ao carregar esteira:", error);
      setOperations([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchPipeline();

    const interval = setInterval(() => {
      fetchPipeline();
    }, 20000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, 60000);

    return () => clearInterval(interval);
  }, []);

  function handleDraftChange(operationId, field, value) {
    setDrafts((prev) => ({
      ...prev,
      [operationId]: {
        ...prev[operationId],
        [field]: value,
      },
    }));
  }

  async function loadOperationHistory(operationId, options = {}) {
    const { force = false } = options;

    if (!force && historyByOperation[operationId]) {
      return;
    }

    try {
      setLoadingHistoryOperationId(operationId);
      const data = await getOperationStatusHistory(operationId);
      setHistoryByOperation((prev) => ({
        ...prev,
        [operationId]: Array.isArray(data) ? data : [],
      }));
    } catch (error) {
      console.error("Erro ao carregar historico da operacao:", error);
      setHistoryByOperation((prev) => ({
        ...prev,
        [operationId]: [],
      }));
    } finally {
      setLoadingHistoryOperationId(null);
    }
  }

  function toggleHistory(operationId) {
    const isCurrentlyOpen = Boolean(openHistory[operationId]);

    if (!isCurrentlyOpen) {
      loadOperationHistory(operationId);
    }

    setOpenHistory((prev) => ({
      ...prev,
      [operationId]: !prev[operationId],
    }));
  }

  function toggleEditor(operationId, editorKey) {
    setOpenEditors((prev) => ({
      ...prev,
      [operationId]: {
        pendencia: false,
        reprovacao: false,
        [editorKey]: !prev[operationId]?.[editorKey],
      },
    }));
  }

  function openEditor(operationId, editorKey) {
    setOpenEditors((prev) => ({
      ...prev,
      [operationId]: {
        pendencia: false,
        reprovacao: false,
        [editorKey]: true,
      },
    }));
  }

  function isEditorOpen(operationId, editorKey) {
    return Boolean(openEditors[operationId]?.[editorKey]);
  }

  async function updateFlow(operation, nextStatus, options = {}) {
    const { payloadOverrides = {}, clearPendencia = false } = options;
    const draft = drafts[operation.id] || {};
    const payload = {
      pendencia_tipo: String(draft.pendencia_tipo || "").trim(),
      pendencia_motivo: String(draft.pendencia_motivo || "").trim(),
      link_formalizacao: String(draft.link_formalizacao || "").trim(),
      motivo_reprovacao: String(draft.motivo_reprovacao || "").trim(),
      status: nextStatus,
      ...payloadOverrides,
    };

    if (clearPendencia) {
      payload.pendencia_tipo = "";
      payload.pendencia_motivo = "";
    }

    if (nextStatus === "AGUARDANDO_FORMALIZACAO" && !payload.link_formalizacao) {
      alert("Informe o link de formalizacao para devolver ao vendedor.");
      return;
    }

    if (nextStatus === "PENDENCIA" && !payload.pendencia_motivo) {
      openEditor(operation.id, "pendencia");
      alert("Informe o motivo da pendencia.");
      return;
    }

    if (nextStatus === "DEVOLVIDA_VENDEDOR" && !payload.pendencia_motivo) {
      openEditor(operation.id, "pendencia");
      alert("Informe o motivo para devolver ao vendedor.");
      return;
    }

    if (nextStatus === "REPROVADO" && !payload.motivo_reprovacao) {
      openEditor(operation.id, "reprovacao");
      alert("Informe o motivo da reprovacao.");
      return;
    }

    try {
      setSavingOperationId(operation.id);
      await updateOperation(operation.id, payload);
      if (openHistory[operation.id]) {
        await loadOperationHistory(operation.id, { force: true });
      }
      setOpenEditors((prev) => ({
        ...prev,
        [operation.id]: {
          pendencia: false,
          reprovacao: false,
        },
      }));
      await fetchPipeline();
      window.dispatchEvent(new Event("pipeline:changed"));
    } catch (error) {
      console.error("Erro ao atualizar operacao:", error);
      alert(error.message || "Nao foi possivel atualizar a operacao");
    } finally {
      setSavingOperationId(null);
    }
  }

  function handleReprovar(operation) {
    const draft = drafts[operation.id] || {};
    const selectedType = String(draft.reprovacao_tipo || "").trim();
    const selectedOption = REPROVACAO_REASON_OPTIONS.find(
      (option) => option.value === selectedType
    );
    const motivoBase = selectedOption?.label || "";
    const detalhe = String(draft.motivo_reprovacao || "").trim();

    if (!selectedType || !motivoBase) {
      openEditor(operation.id, "reprovacao");
      alert("Selecione o motivo da reprovacao.");
      return;
    }

    const motivoFinal = detalhe ? `${motivoBase}: ${detalhe}` : motivoBase;

    updateFlow(operation, "REPROVADO", {
      payloadOverrides: { motivo_reprovacao: motivoFinal },
    });
  }

  function handleDevolver(operation) {
    const draft = drafts[operation.id] || {};
    const motivo = String(draft.pendencia_motivo || "").trim();

    if (!motivo) {
      openEditor(operation.id, "pendencia");
      alert("Informe o motivo da pendencia para devolver ao vendedor.");
      return;
    }

    updateFlow(operation, "DEVOLVIDA_VENDEDOR");
  }

  function handleResolverPendencia(operation) {
    updateFlow(operation, "ANALISE_BANCO", { clearPendencia: true });
  }

  function handleLimparPendencia(operation) {
    handleDraftChange(operation.id, "pendencia_tipo", "");
    handleDraftChange(operation.id, "pendencia_motivo", "");

    if (operation.normalizedStatus === "ANALISE_BANCO") {
      updateFlow(operation, "ANALISE_BANCO", { clearPendencia: true });
    }
  }

  function getStatusBadge(status) {
    const normalized = normalizeStatus(status);

    switch (normalized) {
      case "APROVADO":
        return <span className="statusBadge green">APROVADA</span>;
      case "REPROVADO":
        return <span className="statusBadge red">REPROVADA</span>;
      case "PENDENCIA":
      case "DEVOLVIDA_VENDEDOR":
        return <span className="statusBadge blue">{getStatusLabel(normalized)}</span>;
      default:
        return <span className="statusBadge yellow">{getStatusLabel(normalized)}</span>;
    }
  }

  const rows = useMemo(
    () =>
      [...operations]
        .map((operation) => ({
          ...operation,
          normalizedStatus: normalizeStatus(operation.status),
          priority: getPriorityMeta(operation.criado_em, nowMs),
        }))
        .sort((a, b) => {
          if (a.priority.createdMs !== b.priority.createdMs) {
            return a.priority.createdMs - b.priority.createdMs;
          }
          return Number(a.id || 0) - Number(b.id || 0);
        }),
    [operations, nowMs]
  );

  function openOperationFicha(operation, event) {
    const interactive = event.target.closest(
      "button, input, select, textarea, a, label, .pipelineFlowCell"
    );

    if (interactive) return;
    navigate(`/operations/${operation.id}/ficha`);
  }

  return (
    <div className="pipelineContainer">
      <div className="pipelineHeader">
        <h2>Esteira de Operacoes</h2>
        <p>Fluxo: pronta para digitar, digitacao, formalizacao, analise banco e pendencias.</p>
      </div>

      {loading && <p className="pipelineMessage">Carregando...</p>}

      {!loading && rows.length === 0 ? (
        <p className="pipelineMessage">Nenhuma operacao na esteira.</p>
      ) : (
        <div className="tableWrapper">
          <table className="pipelineTable">
            <thead>
              <tr>
                <th>Prioridade</th>
                <th>Cliente</th>
                <th>Produto</th>
                <th>Status</th>
                <th>Link formalizacao</th>
                <th>Fluxo</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((operation) => {
                const draft = drafts[operation.id] || toDraft(operation);
                const isSaving = savingOperationId === operation.id;
                const pendenciaAberta = isEditorOpen(operation.id, "pendencia");
                const reprovacaoAberta = isEditorOpen(operation.id, "reprovacao");
                const historyOpen = Boolean(openHistory[operation.id]);
                const historyItems = historyByOperation[operation.id] || [];
                const historyLoading = loadingHistoryOperationId === operation.id;
                const canManageFlow = !["APROVADO", "REPROVADO"].includes(
                  operation.normalizedStatus
                );

                return (
                  <tr
                    key={operation.id}
                    className="clickableRow"
                    onClick={(event) => openOperationFicha(operation, event)}
                  >
                    <td>
                      <div className="pipelineIdCell">
                        <span className={`pipelinePriorityBadge ${operation.priority.tone}`}>
                          {operation.priority.label}
                        </span>
                      </div>
                    </td>
                    <td>
                      <strong>{operation.nome}</strong>
                      <div className="pipelineHint">{operation.cpf}</div>
                    </td>
                    <td>
                      <strong>{operation.produto || "-"}</strong>
                      <div className="pipelineHint">{operation.banco_digitacao || "-"}</div>
                    </td>
                    <td>{getStatusBadge(operation.normalizedStatus)}</td>
                    <td>
                      <input
                        type="url"
                        className="proposalInput proposalLinkInput"
                        placeholder="https://..."
                        value={draft.link_formalizacao}
                        onChange={(event) =>
                          handleDraftChange(
                            operation.id,
                            "link_formalizacao",
                            event.target.value
                          )
                        }
                      />
                    </td>
                    <td className="pipelineFlowCell">
                      <div className="pipelineActions">
                        {canManageFlow && (
                          <button
                            type="button"
                            className={`pendingBtn${pendenciaAberta ? " active" : ""}`}
                            disabled={isSaving}
                            onClick={() => toggleEditor(operation.id, "pendencia")}
                          >
                            Pendencia
                          </button>
                        )}

                        {operation.normalizedStatus === "PRONTA_DIGITAR" && (
                          <button
                            type="button"
                            className="saveBtn"
                            disabled={isSaving}
                            onClick={() => updateFlow(operation, "EM_DIGITACAO")}
                          >
                            Iniciar digitacao
                          </button>
                        )}

                        {operation.normalizedStatus === "EM_DIGITACAO" && (
                          <button
                            type="button"
                            className="returnBtn"
                            disabled={isSaving}
                            onClick={() => updateFlow(operation, "AGUARDANDO_FORMALIZACAO")}
                          >
                            Liberar formalizacao
                          </button>
                        )}

                        {operation.normalizedStatus === "ANALISE_BANCO" && (
                          <>
                            <button
                              type="button"
                              className="returnBtn"
                              disabled={isSaving}
                              onClick={() => handleDevolver(operation)}
                            >
                              Devolver
                            </button>
                            <button
                              type="button"
                              className="approveBtn"
                              disabled={isSaving}
                              onClick={() => updateFlow(operation, "APROVADO")}
                            >
                              Aprovar
                            </button>
                            <button
                              type="button"
                              className={`rejectBtn${reprovacaoAberta ? " active" : ""}`}
                              disabled={isSaving}
                              onClick={() => toggleEditor(operation.id, "reprovacao")}
                            >
                              Reprovar
                            </button>
                          </>
                        )}

                        {operation.normalizedStatus === "PENDENCIA" && (
                          <>
                            <button
                              type="button"
                              className="saveBtn"
                              disabled={isSaving}
                              onClick={() => handleResolverPendencia(operation)}
                            >
                              Resolver
                            </button>
                            <button
                              type="button"
                              className="returnBtn"
                              disabled={isSaving}
                              onClick={() => handleDevolver(operation)}
                            >
                              Devolver
                            </button>
                          </>
                        )}

                        <button
                          type="button"
                          className={`historyBtn${historyOpen ? " active" : ""}`}
                          disabled={historyLoading}
                          onClick={() => toggleHistory(operation.id)}
                        >
                          {historyLoading && !historyOpen ? "Carregando..." : "Historico"}
                        </button>
                      </div>

                      {operation.normalizedStatus === "AGUARDANDO_FORMALIZACAO" && (
                        <p className="pipelineInlineHint">Aguardando vendedor formalizar.</p>
                      )}

                      {operation.normalizedStatus === "DEVOLVIDA_VENDEDOR" && (
                        <p className="pipelineInlineHint">Aguardando vendedor reenviar.</p>
                      )}

                      {pendenciaAberta && (
                        <div className="pipelineActionPanel">
                          <h4>Pendencia</h4>
                          <div className="proposalStackField">
                            <select
                              className="proposalInput"
                              value={draft.pendencia_tipo}
                              onChange={(event) =>
                                handleDraftChange(
                                  operation.id,
                                  "pendencia_tipo",
                                  event.target.value
                                )
                              }
                            >
                              {PENDENCIA_TYPE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>

                            <textarea
                              className="proposalTextarea"
                              placeholder="Digite o motivo da pendencia"
                              value={draft.pendencia_motivo}
                              onChange={(event) =>
                                handleDraftChange(
                                  operation.id,
                                  "pendencia_motivo",
                                  event.target.value
                                )
                              }
                            />
                          </div>

                          <div className="pipelinePanelActions">
                            <button
                              type="button"
                              className="pendingBtn"
                              disabled={isSaving}
                              onClick={() => updateFlow(operation, "PENDENCIA")}
                            >
                              Salvar pendencia
                            </button>
                            <button
                              type="button"
                              className="saveBtn"
                              disabled={isSaving}
                              onClick={() => handleResolverPendencia(operation)}
                            >
                              Resolver pendencia
                            </button>
                            <button
                              type="button"
                              className="returnBtn"
                              disabled={isSaving}
                              onClick={() => handleDevolver(operation)}
                            >
                              Devolver vendedor
                            </button>
                            {operation.normalizedStatus === "ANALISE_BANCO" && (
                              <button
                                type="button"
                                className="ghostPipelineBtn"
                                disabled={isSaving}
                                onClick={() => handleLimparPendencia(operation)}
                              >
                                Limpar pendencia
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      {reprovacaoAberta && (
                        <div className="pipelineActionPanel reprovacaoPanel">
                          <h4>Reprovacao</h4>
                          <div className="proposalStackField">
                            <select
                              className="proposalInput"
                              value={draft.reprovacao_tipo || ""}
                              onChange={(event) =>
                                handleDraftChange(
                                  operation.id,
                                  "reprovacao_tipo",
                                  event.target.value
                                )
                              }
                            >
                              {REPROVACAO_REASON_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            <textarea
                              className="proposalTextarea"
                              placeholder="Detalhe opcional"
                              value={draft.motivo_reprovacao}
                              onChange={(event) =>
                                handleDraftChange(
                                  operation.id,
                                  "motivo_reprovacao",
                                  event.target.value
                                )
                              }
                            />
                          </div>

                          <div className="pipelinePanelActions">
                            <button
                              type="button"
                              className="rejectBtn"
                              disabled={isSaving}
                              onClick={() => handleReprovar(operation)}
                            >
                              Confirmar reprovacao
                            </button>
                            <button
                              type="button"
                              className="ghostPipelineBtn"
                              disabled={isSaving}
                              onClick={() => toggleEditor(operation.id, "reprovacao")}
                            >
                              Fechar
                            </button>
                          </div>
                        </div>
                      )}

                      {historyOpen && (
                        <div className="pipelineHistoryPanel">
                          <div className="pipelineHistoryHeader">
                            <h4>Historico de status</h4>
                            <button
                              type="button"
                              className="ghostPipelineBtn"
                              disabled={historyLoading}
                              onClick={() =>
                                loadOperationHistory(operation.id, { force: true })
                              }
                            >
                              {historyLoading ? "Atualizando..." : "Atualizar"}
                            </button>
                          </div>

                          {historyLoading && historyItems.length === 0 ? (
                            <p className="pipelineHistoryEmpty">Carregando historico...</p>
                          ) : historyItems.length === 0 ? (
                            <p className="pipelineHistoryEmpty">Sem historico para esta operacao.</p>
                          ) : (
                            <ul className="pipelineHistoryList">
                              {historyItems.map((item, index) => (
                                <li
                                  key={`${operation.id}-${item.id || index}-${item.created_at || ""}`}
                                  className="pipelineHistoryItem"
                                >
                                  <div className="pipelineHistoryMain">
                                    <strong>{formatHistoryTransition(item)}</strong>
                                    <span>{formatHistoryActor(item)}</span>
                                    {item.note && <small>{item.note}</small>}
                                  </div>
                                  <time>{formatDateTime(item.created_at)}</time>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
