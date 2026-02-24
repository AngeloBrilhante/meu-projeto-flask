import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getPipeline, updateOperation } from "../services/api";
import "./Pipeline.css";

const PRODUCT_OPTIONS = [
  "NOVO",
  "PORTABILIDADE",
  "REFINANCIAMENTO",
  "PORTABILIDADE_REFIN",
  "CARTAO",
];

const STATUS_OPTIONS = [
  { value: "ENVIADA_ESTEIRA", label: "Enviada para esteira" },
  { value: "EM_DIGITACAO", label: "Em digitação" },
  { value: "AGUARDANDO_FORMALIZACAO", label: "Aguardando formalização" },
  { value: "FORMALIZADA", label: "Formalizada" },
  { value: "EM_ANALISE_BANCO", label: "Em análise banco" },
  { value: "PENDENTE_BANCO", label: "Pendente banco" },
  { value: "EM_TRATATIVA_VENDEDOR", label: "Em tratativa vendedor" },
  { value: "REENVIADA_BANCO", label: "Reenviada ao banco" },
  { value: "APROVADO", label: "Aprovada" },
  { value: "REPROVADO", label: "Reprovada" },
];

const PENDENCIA_TYPE_OPTIONS = [
  { value: "", label: "Tipo de pendência" },
  { value: "DOCUMENTACAO", label: "Documentação" },
  { value: "ASSINATURA", label: "Assinatura" },
  { value: "MARGEM", label: "Margem" },
  { value: "DIVERGENCIA_CADASTRAL", label: "Divergência cadastral" },
  { value: "OUTROS", label: "Outros" },
];

const STATUS_LABELS = Object.fromEntries(
  STATUS_OPTIONS.map((option) => [option.value, option.label])
);

const LEGACY_STATUS_MAP = {
  EM_ANALISE: "EM_ANALISE_BANCO",
  DEVOLVIDA: "AGUARDANDO_FORMALIZACAO",
};

function normalizeStatus(status) {
  const normalized = String(status || "").trim().toUpperCase();
  return LEGACY_STATUS_MAP[normalized] || normalized;
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

function toDraft(operation) {
  const status = normalizeStatus(operation.status || "ENVIADA_ESTEIRA");

  return {
    produto: operation.produto ?? "NOVO",
    banco_digitacao: operation.banco_digitacao ?? "",
    valor_liberado:
      operation.valor_liberado ?? operation.valor_solicitado ?? "",
    parcela_liberada:
      operation.parcela_liberada ?? operation.parcela_solicitada ?? "",
    link_formalizacao: operation.link_formalizacao ?? "",
    status,
    pendencia_tipo: operation.pendencia_tipo ?? "",
    pendencia_motivo: operation.pendencia_motivo ?? "",
    pendencia_resposta_vendedor: operation.pendencia_resposta_vendedor ?? "",
    motivo_reprovacao: operation.motivo_reprovacao ?? "",
  };
}

function normalizeStatusLabel(status) {
  const normalized = normalizeStatus(status);
  return STATUS_LABELS[normalized] || normalized || "-";
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

  function validateDraft(draft) {
    const status = normalizeStatus(draft.status);

    if (status === "AGUARDANDO_FORMALIZACAO") {
      const link = String(draft.link_formalizacao || "").trim();
      if (!link) {
        return "Informe o link de formalização para devolver ao vendedor.";
      }
    }

    if (status === "PENDENTE_BANCO") {
      const pendencia = String(draft.pendencia_motivo || "").trim();
      if (!pendencia) {
        return "Informe o motivo da pendência para o vendedor.";
      }
    }

    if (status === "REPROVADO") {
      const motivo = String(draft.motivo_reprovacao || "").trim();
      if (!motivo) {
        return "Informe o motivo da reprovação.";
      }
    }

    return "";
  }

  async function savePipeline(operationId, forcedStatus = "") {
    try {
      setSavingOperationId(operationId);

      const draft = {
        ...(drafts[operationId] || {}),
      };

      if (forcedStatus) {
        draft.status = forcedStatus;
      }

      draft.status = normalizeStatus(draft.status);

      const validationError = validateDraft(draft);
      if (validationError) {
        alert(validationError);
        setSavingOperationId(null);
        return;
      }

      const payload = {
        produto: draft.produto,
        banco_digitacao: draft.banco_digitacao,
        status: draft.status,
        valor_liberado:
          draft.valor_liberado === "" ? null : draft.valor_liberado,
        parcela_liberada:
          draft.parcela_liberada === "" ? null : draft.parcela_liberada,
        link_formalizacao: String(draft.link_formalizacao || "").trim(),
        pendencia_tipo: String(draft.pendencia_tipo || "").trim(),
        pendencia_motivo: String(draft.pendencia_motivo || "").trim(),
        pendencia_resposta_vendedor: String(
          draft.pendencia_resposta_vendedor || ""
        ).trim(),
        motivo_reprovacao: String(draft.motivo_reprovacao || "").trim(),
      };

      await updateOperation(operationId, payload);
      await fetchPipeline();
      window.dispatchEvent(new Event("pipeline:changed"));
    } catch (error) {
      console.error("Erro ao atualizar operação:", error);
      alert(error.message || "Não foi possível atualizar a operação");
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
      case "PENDENTE_BANCO":
        return <span className="statusBadge blue">PENDENTE BANCO</span>;
      default:
        return <span className="statusBadge yellow">EM PROCESSO</span>;
    }
  }

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
        <h2>Esteira de Operações</h2>
        <p>
          Fluxo completo: digitação, formalização, análise banco, pendência e
          tratativa com vendedor.
        </p>
      </div>

      {loading && <p className="pipelineMessage">Carregando...</p>}

      {!loading && operations.length === 0 ? (
        <p className="pipelineMessage">Nenhuma operação em análise.</p>
      ) : (
        <div className="tableWrapper">
          <table className="pipelineTable">
            <thead>
              <tr>
                <th>ID</th>
                <th>Cliente</th>
                <th>CPF</th>
                <th>Produto</th>
                <th>Banco</th>
                <th>Status atual</th>
                <th>Próximo status</th>
                <th>Link formalização</th>
                <th>Pendência banco</th>
                <th>Resposta vendedor</th>
                <th>Motivo reprovação</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {operations.map((operation) => {
                const draft = drafts[operation.id] || toDraft(operation);
                const isSaving = savingOperationId === operation.id;
                const currentStatus = normalizeStatus(operation.status);
                const selectedStatus = normalizeStatus(draft.status);

                return (
                  <tr
                    key={operation.id}
                    className="clickableRow"
                    onClick={(event) => openOperationFicha(operation, event)}
                  >
                    <td>{operation.id}</td>
                    <td>{operation.nome}</td>
                    <td>{operation.cpf}</td>
                    <td>
                      <select
                        className="proposalInput"
                        value={draft.produto ?? "NOVO"}
                        onChange={(event) =>
                          handleDraftChange(
                            operation.id,
                            "produto",
                            event.target.value
                          )
                        }
                      >
                        {PRODUCT_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="text"
                        className="proposalInput"
                        value={draft.banco_digitacao ?? ""}
                        onChange={(event) =>
                          handleDraftChange(
                            operation.id,
                            "banco_digitacao",
                            event.target.value
                          )
                        }
                      />
                    </td>
                    <td>
                      <div className="pipelineStatusCell">
                        {getStatusBadge(currentStatus)}
                        <small>{normalizeStatusLabel(currentStatus)}</small>
                      </div>
                    </td>
                    <td>
                      <select
                        className="proposalInput"
                        value={selectedStatus}
                        onChange={(event) =>
                          handleDraftChange(
                            operation.id,
                            "status",
                            event.target.value
                          )
                        }
                      >
                        {STATUS_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="url"
                        className="proposalInput proposalLinkInput"
                        placeholder="https://..."
                        value={draft.link_formalizacao ?? ""}
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
                          value={draft.pendencia_tipo ?? ""}
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
                          placeholder="Descreva a pendência para o vendedor"
                          value={draft.pendencia_motivo ?? ""}
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
                        placeholder="Resposta do vendedor"
                        value={draft.pendencia_resposta_vendedor ?? ""}
                        onChange={(event) =>
                          handleDraftChange(
                            operation.id,
                            "pendencia_resposta_vendedor",
                            event.target.value
                          )
                        }
                      />
                    </td>
                    <td>
                      <textarea
                        className="proposalTextarea"
                        placeholder="Motivo da reprovação"
                        value={draft.motivo_reprovacao ?? ""}
                        onChange={(event) =>
                          handleDraftChange(
                            operation.id,
                            "motivo_reprovacao",
                            event.target.value
                          )
                        }
                      />
                    </td>
                    <td className="pipelineActions">
                      <button
                        type="button"
                        className="saveBtn"
                        disabled={isSaving}
                        onClick={() => savePipeline(operation.id)}
                      >
                        Salvar
                      </button>

                      <button
                        type="button"
                        className="approveBtn"
                        disabled={isSaving}
                        onClick={() => savePipeline(operation.id, "APROVADO")}
                      >
                        Aprovar
                      </button>

                      <button
                        type="button"
                        className="rejectBtn"
                        disabled={isSaving}
                        onClick={() => savePipeline(operation.id, "REPROVADO")}
                      >
                        Reprovar
                      </button>
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
