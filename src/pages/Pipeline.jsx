import { useEffect, useMemo, useState } from "react";
import { getApiUrl } from "../config/api";
import { getPipeline, listClientDocuments, updateOperation } from "../services/api";
import "./Pipeline.css";

const API_URL = getApiUrl();

const PRODUCT_OPTIONS = [
  "NOVO",
  "PORTABILIDADE",
  "REFINANCIAMENTO",
  "PORTABILIDADE_REFIN",
  "CARTAO",
];

const PORTABILITY_PRODUCTS = new Set(["PORTABILIDADE", "PORTABILIDADE_REFIN"]);

const PORTABILITY_DETAIL_GROUPS = [
  {
    title: "Dados gerais",
    fields: [
      { key: "vendedor_nome", label: "Vendedor" },
      { key: "banco_nome", label: "Banco da proposta" },
      { key: "cliente_negativo", label: "Negativo do cliente" },
    ],
  },
  {
    title: "Dados do cliente",
    fields: [
      { key: "cliente_nome", label: "Nome" },
      { key: "especie", label: "Especie" },
      { key: "uf_beneficio", label: "UF beneficio" },
      { key: "numero_beneficio", label: "Numero beneficio" },
      { key: "data_nascimento", label: "Data nascimento", type: "date" },
      { key: "cpf", label: "CPF" },
      { key: "rg", label: "RG" },
      { key: "data_emissao", label: "Data emissao", type: "date" },
      { key: "nome_mae", label: "Nome mae" },
      { key: "telefone", label: "Telefone" },
      { key: "email", label: "Email" },
      { key: "cep", label: "CEP" },
      { key: "endereco", label: "Endereco" },
      { key: "bairro", label: "Bairro" },
    ],
  },
  {
    title: "Dados bancarios",
    fields: [
      { key: "conta", label: "Conta" },
      { key: "agencia", label: "Agencia" },
      { key: "banco", label: "Banco" },
      { key: "tipo_conta", label: "Tipo conta" },
    ],
  },
  {
    title: "Dados portados",
    fields: [
      { key: "banco_portado", label: "Banco portado" },
      { key: "contrato_portado", label: "Contrato portado" },
      { key: "total_parcelas", label: "Total parcelas" },
      { key: "parcelas_pagas", label: "Parcelas pagas" },
      { key: "parcelas_restantes", label: "Parcelas restantes" },
      { key: "saldo_quitacao", label: "Saldo quitacao", type: "currency" },
      { key: "valor_parcela", label: "Valor parcela", type: "currency" },
    ],
  },
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

function formatDate(value) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleDateString("pt-BR");
}

function parsePortabilityForm(payload) {
  if (!payload) return null;

  if (typeof payload === "string") {
    try {
      return JSON.parse(payload);
    } catch {
      return null;
    }
  }

  if (typeof payload === "object") return payload;
  return null;
}

function isPortabilityProduct(product) {
  return PORTABILITY_PRODUCTS.has(String(product || "").toUpperCase());
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
    ficha_portabilidade: parsePortabilityForm(operation.ficha_portabilidade),
  };
}

function formatPortabilityValue(value, type) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return "-";
  }

  if (type === "currency") {
    return formatCurrency(value);
  }

  if (type === "date") {
    return formatDate(value);
  }

  return String(value);
}

export default function Pipeline() {
  const [operations, setOperations] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(false);
  const [savingOperationId, setSavingOperationId] = useState(null);
  const [selectedOperationId, setSelectedOperationId] = useState(null);
  const [documentsByClient, setDocumentsByClient] = useState({});
  const [documentsError, setDocumentsError] = useState("");
  const [loadingClientDocumentsId, setLoadingClientDocumentsId] = useState(null);

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
      setSelectedOperationId((previous) => {
        if (previous && list.some((operation) => operation.id === previous)) {
          return previous;
        }

        return list[0]?.id ?? null;
      });
    } catch (error) {
      console.error("Erro ao carregar esteira:", error);
      setOperations([]);
      setSelectedOperationId(null);
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

  const selectedOperation = useMemo(
    () => operations.find((operation) => operation.id === selectedOperationId) || null,
    [operations, selectedOperationId]
  );

  const selectedDraft = useMemo(() => {
    if (!selectedOperation) return null;
    return drafts[selectedOperation.id] || toDraft(selectedOperation);
  }, [drafts, selectedOperation]);

  const selectedPortabilityForm = useMemo(() => {
    if (!selectedOperation) return null;
    const payload =
      selectedDraft?.ficha_portabilidade ?? selectedOperation.ficha_portabilidade;
    return parsePortabilityForm(payload);
  }, [selectedDraft, selectedOperation]);

  useEffect(() => {
    if (!selectedOperation?.cliente_id) return;

    const clientId = selectedOperation.cliente_id;
    if (Object.prototype.hasOwnProperty.call(documentsByClient, clientId)) return;

    let cancelled = false;

    async function loadClientDocuments() {
      try {
        setDocumentsError("");
        setLoadingClientDocumentsId(clientId);

        const data = await listClientDocuments(clientId);
        const list = Array.isArray(data?.documents) ? data.documents : [];

        if (!cancelled) {
          setDocumentsByClient((prev) => ({
            ...prev,
            [clientId]: list,
          }));
        }
      } catch (error) {
        console.error("Erro ao carregar documentos na esteira:", error);
        if (!cancelled) {
          setDocumentsError("Nao foi possivel carregar os documentos do cliente.");
          setDocumentsByClient((prev) => ({
            ...prev,
            [clientId]: [],
          }));
        }
      } finally {
        if (!cancelled) {
          setLoadingClientDocumentsId(null);
        }
      }
    }

    loadClientDocuments();

    return () => {
      cancelled = true;
    };
  }, [selectedOperation, documentsByClient]);

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

  async function handleDocumentDownload(clientId, filename) {
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(
        `${API_URL}/clients/${clientId}/documents/${encodeURIComponent(filename)}`,
        {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        }
      );

      if (!response.ok) {
        throw new Error("Falha ao baixar documento");
      }

      const blob = await response.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(objectUrl);
    } catch (error) {
      console.error("Erro ao baixar documento:", error);
      alert("Nao foi possivel baixar o documento.");
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

  function handleRowClick(operation, event) {
    const interactive = event.target.closest(
      "button, input, select, textarea, a, label"
    );

    if (interactive) {
      return;
    }

    setSelectedOperationId(operation.id);
  }

  const selectedDocuments = selectedOperation
    ? documentsByClient[selectedOperation.cliente_id] || []
    : [];

  return (
    <div className="pipelineContainer">
      <div className="pipelineHeader">
        <h2>Esteira de Operacoes</h2>
        <p>Operacoes em analise para aprovacao, devolucao ou reprovacao.</p>
      </div>

      {loading && <p className="pipelineMessage">Carregando...</p>}

      {!loading && operations.length === 0 ? (
        <p className="pipelineMessage">Nenhuma operacao em analise.</p>
      ) : (
        <>
          <p className="pipelineHint">
            Clique em uma operacao para ver a ficha completa e documentos.
          </p>

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
                      className={`clickableRow ${
                        selectedOperationId === operation.id ? "selectedRow" : ""
                      }`}
                      onClick={(event) => handleRowClick(operation, event)}
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

          {selectedOperation && (
            <section className="pipelineDetailsCard">
              <header className="pipelineDetailsHeader">
                <div>
                  <h3>
                    Ficha da operacao #{selectedOperation.id} -{" "}
                    {selectedOperation.nome}
                  </h3>
                  <p>
                    Produto {selectedOperation.produto || "-"} | CPF{" "}
                    {selectedOperation.cpf || "-"}
                  </p>
                </div>
                <div>{getStatusBadge(selectedOperation.status)}</div>
              </header>

              <div className="pipelineDetailsGrid">
                <article>
                  <span>Vendedor</span>
                  <strong>
                    {selectedOperation.vendedor_nome ||
                      selectedOperation.vendedor_id ||
                      "-"}
                  </strong>
                </article>
                <article>
                  <span>Banco digitacao</span>
                  <strong>{selectedOperation.banco_digitacao || "-"}</strong>
                </article>
                <article>
                  <span>Prazo</span>
                  <strong>{selectedOperation.prazo || "-"}</strong>
                </article>
                <article>
                  <span>Valor solicitado</span>
                  <strong>{formatCurrency(selectedOperation.valor_solicitado)}</strong>
                </article>
                <article>
                  <span>Parcela solicitada</span>
                  <strong>
                    {formatCurrency(selectedOperation.parcela_solicitada)}
                  </strong>
                </article>
                <article>
                  <span>Valor liberado</span>
                  <strong>{formatCurrency(selectedOperation.valor_liberado)}</strong>
                </article>
                <article>
                  <span>Parcela liberada</span>
                  <strong>{formatCurrency(selectedOperation.parcela_liberada)}</strong>
                </article>
                <article className="full">
                  <span>Link formalizacao</span>
                  <strong>
                    {selectedOperation.link_formalizacao ? (
                      <a
                        href={selectedOperation.link_formalizacao}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {selectedOperation.link_formalizacao}
                      </a>
                    ) : (
                      "-"
                    )}
                  </strong>
                </article>
              </div>

              {isPortabilityProduct(selectedOperation.produto) ? (
                selectedPortabilityForm ? (
                  <div className="pipelineFichaSection">
                    <h4>Ficha de Portabilidade</h4>

                    {PORTABILITY_DETAIL_GROUPS.map((group) => (
                      <div key={group.title} className="pipelineFichaGroup">
                        <h5>{group.title}</h5>
                        <div className="pipelineFichaGrid">
                          {group.fields.map((field) => (
                            <article key={field.key}>
                              <span>{field.label}</span>
                              <strong>
                                {formatPortabilityValue(
                                  selectedPortabilityForm[field.key],
                                  field.type
                                )}
                              </strong>
                            </article>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="pipelineMessage">
                    Esta operacao de portabilidade ainda nao possui ficha preenchida.
                  </p>
                )
              ) : (
                <p className="pipelineMessage">
                  Este produto nao possui ficha especifica cadastrada.
                </p>
              )}

              <div className="pipelineDocumentsBlock">
                <h4>Documentos enviados</h4>

                {documentsError && (
                  <p className="pipelineMessage pipelineInlineMessage">
                    {documentsError}
                  </p>
                )}

                {loadingClientDocumentsId === selectedOperation.cliente_id ? (
                  <p className="pipelineMessage pipelineInlineMessage">
                    Carregando documentos...
                  </p>
                ) : selectedDocuments.length === 0 ? (
                  <p className="pipelineMessage pipelineInlineMessage">
                    Nenhum documento enviado para este cliente.
                  </p>
                ) : (
                  <ul className="pipelineDocumentsList">
                    {selectedDocuments.map((document) => (
                      <li key={document.filename} className="pipelineDocumentItem">
                        <div>
                          <strong>{document.type || "ARQUIVO"}</strong>
                          <span>{document.filename}</span>
                          <small>{document.uploaded_at || "-"}</small>
                        </div>
                        <button
                          type="button"
                          className="pipelineDownloadBtn"
                          onClick={() =>
                            handleDocumentDownload(
                              selectedOperation.cliente_id,
                              document.filename
                            )
                          }
                        >
                          Baixar
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
