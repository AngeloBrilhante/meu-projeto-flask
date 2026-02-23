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
  return {
    produto: operation.produto ?? "NOVO",
    banco_digitacao: operation.banco_digitacao ?? "",
    valor_liberado:
      operation.valor_liberado ?? operation.valor_solicitado ?? "",
    parcela_liberada:
      operation.parcela_liberada ?? operation.parcela_solicitada ?? "",
    link_formalizacao: operation.link_formalizacao ?? "",
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
          next[operation.id] = prev[operation.id] ?? toDraft(operation);
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

  async function saveProposal(operationId, action = "save") {
    try {
      setSavingOperationId(operationId);

      const draft = drafts[operationId] || {};
      const payload = {
        produto: draft.produto,
        banco_digitacao: draft.banco_digitacao,
        valor_liberado:
          draft.valor_liberado === "" ? null : draft.valor_liberado,
        parcela_liberada:
          draft.parcela_liberada === "" ? null : draft.parcela_liberada,
      };

      if (action === "devolver") {
        const link = String(draft.link_formalizacao || "").trim();

        if (!link) {
          alert("Informe o link de formalizacao para devolver ao vendedor");
          setSavingOperationId(null);
          return;
        }

        payload.status = "DEVOLVIDA";
        payload.link_formalizacao = link;
      }

      if (action === "aprovar") {
        payload.status = "APROVADO";
      }

      if (action === "reprovar") {
        payload.status = "REPROVADO";
      }

      await updateOperation(operationId, payload);
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
    switch (status) {
      case "APROVADO":
        return <span className="statusBadge green">APROVADO</span>;
      case "REPROVADO":
        return <span className="statusBadge red">REPROVADO</span>;
      case "EM_ANALISE":
        return <span className="statusBadge yellow">EM ANALISE</span>;
      case "DEVOLVIDA":
        return <span className="statusBadge blue">DEVOLVIDA</span>;
      default:
        return <span className="statusBadge gray">{status}</span>;
    }
  }

  function openOperationFicha(operation, event) {
    const interactive = event.target.closest(
      "button, input, select, textarea, a, label"
    );

    if (interactive) return;

    navigate(
      `/clients/${operation.cliente_id}/operacoes?operation=${operation.id}&view=ficha`
    );
  }

  return (
    <div className="pipelineContainer">
      <div className="pipelineHeader">
        <h2>Esteira de Operacoes</h2>
        <p>Clique na operacao para abrir a aba com a ficha completa.</p>
      </div>

      {loading && <p className="pipelineMessage">Carregando...</p>}

      {!loading && operations.length === 0 ? (
        <p className="pipelineMessage">Nenhuma operacao em analise.</p>
      ) : (
        <div className="tableWrapper">
          <table className="pipelineTable">
            <thead>
              <tr>
                <th>ID</th>
                <th>Cliente</th>
                <th>CPF</th>
                <th>Vendedor</th>
                <th>Tipo operacao</th>
                <th>Banco</th>
                <th>Valor solicitado</th>
                <th>Parcela solicitada</th>
                <th>Valor real</th>
                <th>Parcela real</th>
                <th>Link formalizacao</th>
                <th>Status</th>
                <th>Acao</th>
              </tr>
            </thead>
            <tbody>
              {operations.map((operation) => {
                const draft = drafts[operation.id] || toDraft(operation);
                const isSaving = savingOperationId === operation.id;

                return (
                  <tr
                    key={operation.id}
                    className="clickableRow"
                    onClick={(event) => openOperationFicha(operation, event)}
                  >
                    <td>{operation.id}</td>
                    <td>{operation.nome}</td>
                    <td>{operation.cpf}</td>
                    <td>{operation.vendedor_nome || operation.vendedor_id || "-"}</td>
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
                    <td>{formatCurrency(operation.valor_solicitado)}</td>
                    <td>{formatCurrency(operation.parcela_solicitada)}</td>
                    <td>
                      <input
                        type="number"
                        className="proposalInput"
                        value={draft.valor_liberado ?? ""}
                        onChange={(event) =>
                          handleDraftChange(
                            operation.id,
                            "valor_liberado",
                            event.target.value
                          )
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className="proposalInput"
                        value={draft.parcela_liberada ?? ""}
                        onChange={(event) =>
                          handleDraftChange(
                            operation.id,
                            "parcela_liberada",
                            event.target.value
                          )
                        }
                      />
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
                    <td>{getStatusBadge(operation.status)}</td>
                    <td className="pipelineActions">
                      <button
                        type="button"
                        className="saveBtn"
                        disabled={isSaving}
                        onClick={() => saveProposal(operation.id)}
                      >
                        Salvar
                      </button>

                      <button
                        type="button"
                        className="returnBtn"
                        disabled={isSaving}
                        onClick={() => saveProposal(operation.id, "devolver")}
                      >
                        Devolver
                      </button>

                      <button
                        type="button"
                        className="approveBtn"
                        disabled={isSaving}
                        onClick={() => saveProposal(operation.id, "aprovar")}
                      >
                        Aprovar
                      </button>

                      <button
                        type="button"
                        className="rejectBtn"
                        disabled={isSaving}
                        onClick={() => saveProposal(operation.id, "reprovar")}
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
