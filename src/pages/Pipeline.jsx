import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getPipeline, updateOperation } from "../services/api";
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
  };
}

export default function Pipeline() {
  const navigate = useNavigate();
  const [operations, setOperations] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(false);
  const [savingOperationId, setSavingOperationId] = useState(null);

  async function fetchPipeline() {
    try {
      setLoading(true);
      const data = await getPipeline();
      const list = Array.isArray(data) ? data : [];

      setOperations(list);
      setDrafts((prev) => {
        const next = {};

        list.forEach((operation) => {
          next[operation.id] = {
            ...toDraft(operation),
            ...(prev[operation.id] || {}),
          };
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

  function handleDraftChange(operationId, field, value) {
    setDrafts((prev) => ({
      ...prev,
      [operationId]: {
        ...prev[operationId],
        [field]: value,
      },
    }));
  }

  async function updateFlow(operation, nextStatus) {
    const draft = drafts[operation.id] || {};
    const payload = {
      pendencia_tipo: String(draft.pendencia_tipo || "").trim(),
      pendencia_motivo: String(draft.pendencia_motivo || "").trim(),
      link_formalizacao: String(draft.link_formalizacao || "").trim(),
      motivo_reprovacao: String(draft.motivo_reprovacao || "").trim(),
      status: nextStatus,
    };

    if (nextStatus === "AGUARDANDO_FORMALIZACAO" && !payload.link_formalizacao) {
      alert("Informe o link de formalizacao para devolver ao vendedor.");
      return;
    }

    if (nextStatus === "PENDENCIA" && !payload.pendencia_motivo) {
      alert("Informe o motivo da pendencia.");
      return;
    }

    if (nextStatus === "DEVOLVIDA_VENDEDOR" && !payload.pendencia_motivo) {
      alert("Informe o motivo para devolver ao vendedor.");
      return;
    }

    if (nextStatus === "REPROVADO" && !payload.motivo_reprovacao) {
      alert("Informe o motivo da reprovacao.");
      return;
    }

    try {
      setSavingOperationId(operation.id);
      await updateOperation(operation.id, payload);
      await fetchPipeline();
      window.dispatchEvent(new Event("pipeline:changed"));
    } catch (error) {
      console.error("Erro ao atualizar operacao:", error);
      alert(error.message || "Nao foi possivel atualizar a operacao");
    } finally {
      setSavingOperationId(null);
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
      operations.map((operation) => ({
        ...operation,
        normalizedStatus: normalizeStatus(operation.status),
      })),
    [operations]
  );

  function openOperationFicha(operation, event) {
    const interactive = event.target.closest(
      "button, input, select, textarea, a, label"
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
                <th>ID</th>
                <th>Cliente</th>
                <th>Produto</th>
                <th>Status</th>
                <th>Link formalizacao</th>
                <th>Pendencia</th>
                <th>Motivo reprovacao</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((operation) => {
                const draft = drafts[operation.id] || toDraft(operation);
                const isSaving = savingOperationId === operation.id;

                return (
                  <tr
                    key={operation.id}
                    className="clickableRow"
                    onClick={(event) => openOperationFicha(operation, event)}
                  >
                    <td>{operation.id}</td>
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
                    <td>
                      <div className="proposalStackField">
                        <select
                          className="proposalInput"
                          value={draft.pendencia_tipo}
                          onChange={(event) =>
                            handleDraftChange(operation.id, "pendencia_tipo", event.target.value)
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
                          placeholder="Descreva a pendencia"
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
                    </td>
                    <td>
                      <textarea
                        className="proposalTextarea"
                        placeholder="Motivo da reprovacao"
                        value={draft.motivo_reprovacao}
                        onChange={(event) =>
                          handleDraftChange(
                            operation.id,
                            "motivo_reprovacao",
                            event.target.value
                          )
                        }
                      />
                    </td>
                    <td>
                      <div className="pipelineActions">
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

                        {operation.normalizedStatus === "AGUARDANDO_FORMALIZACAO" && (
                          <span className="pipelineHint">Aguardando vendedor formalizar</span>
                        )}

                        {operation.normalizedStatus === "ANALISE_BANCO" && (
                          <>
                            <button
                              type="button"
                              className="returnBtn"
                              disabled={isSaving}
                              onClick={() => updateFlow(operation, "PENDENCIA")}
                            >
                              Pendencia
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
                              className="rejectBtn"
                              disabled={isSaving}
                              onClick={() => updateFlow(operation, "REPROVADO")}
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
                              onClick={() => updateFlow(operation, "ANALISE_BANCO")}
                            >
                              Pendencia resolvida
                            </button>
                            <button
                              type="button"
                              className="returnBtn"
                              disabled={isSaving}
                              onClick={() => updateFlow(operation, "DEVOLVIDA_VENDEDOR")}
                            >
                              Devolver vendedor
                            </button>
                          </>
                        )}

                        {operation.normalizedStatus === "DEVOLVIDA_VENDEDOR" && (
                          <span className="pipelineHint">Aguardando vendedor reenviar</span>
                        )}
                      </div>
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
