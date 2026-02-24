import { useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import {
  buildOperationPayloadFromFicha,
  getOperationSchema,
  hasOperationFicha,
  mergeOperationFicha,
} from "../../constants/operationSchemas";
import {
  createOperation,
  listClientOperations,
  sendOperationToPipeline,
  updateOperation,
} from "../../services/api";

const EMPTY_FORM = {
  produto: "",
  ficha_portabilidade: {},
};

const PRODUCT_OPTIONS = [
  { value: "NOVO", label: "Novo" },
  { value: "PORTABILIDADE", label: "Portabilidade" },
  { value: "REFINANCIAMENTO", label: "Refinanciamento" },
  { value: "PORTABILIDADE_REFIN", label: "Port + Refin" },
  { value: "CARTAO", label: "Cartão" },
];

const STATUS_LABELS = {
  PENDENTE: "Pendente",
  ENVIADA_ESTEIRA: "Enviada para esteira",
  EM_DIGITACAO: "Em digitação",
  AGUARDANDO_FORMALIZACAO: "Aguardando formalização",
  FORMALIZADA: "Formalizada",
  EM_ANALISE_BANCO: "Em análise banco",
  PENDENTE_BANCO: "Pendente banco",
  EM_TRATATIVA_VENDEDOR: "Em tratativa vendedor",
  REENVIADA_BANCO: "Reenviada ao banco",
  APROVADO: "Aprovada",
  REPROVADO: "Reprovada",
};

const LEGACY_STATUS_MAP = {
  EM_ANALISE: "EM_ANALISE_BANCO",
  DEVOLVIDA: "AGUARDANDO_FORMALIZACAO",
};

function normalizeStatus(status) {
  const normalized = String(status || "").trim().toUpperCase();
  return LEGACY_STATUS_MAP[normalized] || normalized;
}

function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem("usuario") || "null");
  } catch {
    return null;
  }
}

function getOperationSeed(operation = {}) {
  return {
    banco_digitacao: operation.banco_digitacao || "",
    margem: operation.margem || "",
    prazo: operation.prazo || "",
    valor_solicitado: operation.valor_solicitado || "",
    parcela_solicitada: operation.parcela_solicitada || "",
  };
}

function formatCurrency(value) {
  const number = Number(value);
  if (Number.isNaN(number)) return "-";
  return number.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function formatStatus(status) {
  const normalized = normalizeStatus(status);
  return STATUS_LABELS[normalized] || normalized.replaceAll("_", " ");
}

export default function ClientOperations() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { client } = useOutletContext() || {};

  const [operations, setOperations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editingOperationId, setEditingOperationId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const user = useMemo(() => getStoredUser(), []);
  const isVendor = String(user?.role || "").toUpperCase() === "VENDEDOR";
  const formSchema = getOperationSchema(form.produto);

  async function loadOperations() {
    try {
      const data = await listClientOperations(id);
      setOperations(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Erro ao carregar operações:", error);
      setOperations([]);
    }
  }

  useEffect(() => {
    if (id) loadOperations();
  }, [id]);

  useEffect(() => {
    if (!client || editingOperationId || !form.produto) return;

    setForm((prev) => {
      const seed = buildOperationPayloadFromFicha(
        prev.produto,
        prev.ficha_portabilidade,
        prev
      );

      return {
        ...prev,
        ficha_portabilidade: mergeOperationFicha(
          prev.produto,
          client,
          user,
          prev.ficha_portabilidade,
          seed
        ),
      };
    });
  }, [client, editingOperationId, form.produto, user]);

  function resetForm(product = "") {
    const seed = getOperationSeed();

    setForm({
      produto: product,
      ficha_portabilidade: product
        ? mergeOperationFicha(product, client, user, null, seed)
        : {},
    });
    setEditingOperationId(null);
  }

  function handleProdutoChange(nextProduct) {
    setForm((prev) => {
      const seed = buildOperationPayloadFromFicha(
        prev.produto,
        prev.ficha_portabilidade,
        prev
      );

      return {
        produto: nextProduct,
        ficha_portabilidade: nextProduct
          ? mergeOperationFicha(
              nextProduct,
              client,
              user,
              prev.ficha_portabilidade,
              seed
            )
          : {},
      };
    });
  }

  function handleFichaChange(event) {
    const { name, value } = event.target;

    setForm((prev) => ({
      ...prev,
      ficha_portabilidade: {
        ...prev.ficha_portabilidade,
        [name]: value,
      },
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!form.produto) {
      alert("Selecione um produto para preencher a ficha.");
      return;
    }

    if (!formSchema) {
      alert("Não existe ficha configurada para este produto.");
      return;
    }

    setLoading(true);

    try {
      const payload = buildOperationPayloadFromFicha(
        form.produto,
        form.ficha_portabilidade
      );

      if (editingOperationId) {
        await updateOperation(editingOperationId, payload);
        alert("Operação editada com sucesso");
      } else {
        await createOperation(id, payload);
        alert("Operação criada com sucesso");
      }

      resetForm("");
      await loadOperations();
    } catch (error) {
      console.error("Erro ao salvar operação:", error);
      alert(error.message || "Não foi possível salvar a operação");
    } finally {
      setLoading(false);
    }
  }

  async function handleSend(operationId) {
    try {
      await sendOperationToPipeline(operationId);
      await loadOperations();
      window.dispatchEvent(new Event("pipeline:changed"));
      alert("Operação enviada para esteira");
    } catch (error) {
      alert(error.message || "Não foi possível enviar para esteira");
    }
  }

  async function handlePendingResponse(operation) {
    const initial = String(operation.pendencia_resposta_vendedor || "");
    const response = window.prompt(
      "Descreva a resposta da pendência para o banco:",
      initial
    );

    if (response === null) return;

    const text = String(response || "").trim();
    if (!text) {
      alert("Informe a resposta para continuar.");
      return;
    }

    try {
      await updateOperation(operation.id, {
        pendencia_resposta_vendedor: text,
        status: "EM_TRATATIVA_VENDEDOR",
      });
      await loadOperations();
      alert("Resposta registrada. Agora você pode reenviar ao banco.");
    } catch (error) {
      alert(error.message || "Não foi possível registrar a resposta.");
    }
  }

  function handleEdit(operation) {
    const product = operation.produto || "NOVO";
    const seed = getOperationSeed(operation);

    setEditingOperationId(operation.id);
    setForm({
      produto: product,
      ficha_portabilidade: mergeOperationFicha(
        product,
        client,
        user,
        operation.ficha_portabilidade,
        seed
      ),
    });
  }

  function openFicha(operationId) {
    navigate(`/operations/${operationId}/ficha`);
  }

  const sortedOperations = useMemo(() => {
    return [...operations].sort((a, b) => {
      const timeA = new Date(a.criado_em || 0).getTime();
      const timeB = new Date(b.criado_em || 0).getTime();
      return timeB - timeA;
    });
  }, [operations]);

  return (
    <div className="clientSection clientOperationsSection">
      <h2>Operações</h2>

      <form onSubmit={handleSubmit} className="operationsFormCard">
        <h3>{editingOperationId ? "Editar operação" : "Nova operação"}</h3>

        <label className="operationsField operationProductField">
          <span>Produto</span>
          <select
            name="produto"
            value={form.produto}
            onChange={(event) => handleProdutoChange(event.target.value)}
            required
          >
            <option value="">Selecione um produto</option>
            {PRODUCT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {!form.produto && (
          <p className="operationFichaHint">
            Selecione o produto para abrir a ficha específica.
          </p>
        )}

        {form.produto && !formSchema && (
          <p className="operationFichaHint">
            Não existe ficha configurada para este produto.
          </p>
        )}

        {formSchema && (
          <section className="operationFichaCard">
            <h4>{formSchema.title}</h4>

            {formSchema.groups.map((group) => (
              <div key={group.title} className="operationFichaGroup">
                <h5>{group.title}</h5>

                <div className="operationFichaGrid">
                  {group.fields.map((field) => {
                    const value = form.ficha_portabilidade?.[field.name] ?? "";

                    return (
                      <label className="operationsField" key={field.name}>
                        <span>{field.label}</span>

                        {Array.isArray(field.options) ? (
                          <select
                            name={field.name}
                            value={value}
                            onChange={handleFichaChange}
                            required={field.required}
                          >
                            {field.options.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type={field.type || "text"}
                            name={field.name}
                            value={value}
                            min={field.min}
                            step={field.step}
                            required={field.required}
                            onChange={handleFichaChange}
                          />
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </section>
        )}

        <div className="operationsActions">
          <button
            type="submit"
            className="clientPrimaryButton"
            disabled={loading || !formSchema}
          >
            {loading ? "Salvando..." : editingOperationId ? "Salvar edição" : "Criar operação"}
          </button>

          {editingOperationId && (
            <button
              type="button"
              className="clientGhostButton"
              onClick={() => resetForm("")}
            >
              Cancelar edição
            </button>
          )}
        </div>
      </form>

      <h3>Operações cadastradas</h3>

      {sortedOperations.length === 0 ? (
        <p className="clientSectionText">Nenhuma operação cadastrada.</p>
      ) : (
        <div className="operationsTableWrap">
          <table className="operationsTable">
            <thead>
              <tr>
                <th>Produto</th>
                <th>Banco</th>
                <th>Valor</th>
                <th>Prazo</th>
                <th>Ficha</th>
                <th>Status</th>
                <th>Pendência banco</th>
                <th>Resposta vendedor</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {sortedOperations.map((operation) => {
                const normalizedStatus = normalizeStatus(operation.status);
                const canEdit = normalizedStatus === "PENDENTE";
                const canSend =
                  normalizedStatus === "PENDENTE" ||
                  normalizedStatus === "PENDENTE_BANCO" ||
                  normalizedStatus === "EM_TRATATIVA_VENDEDOR";
                const canRespondPending =
                  isVendor && normalizedStatus === "PENDENTE_BANCO";

                return (
                  <tr key={operation.id}>
                    <td>{operation.produto}</td>
                    <td>{operation.banco_digitacao || "-"}</td>
                    <td>{formatCurrency(operation.valor_solicitado)}</td>
                    <td>{operation.prazo || "-"}</td>
                    <td>
                      <button
                        type="button"
                        className="clientGhostButton"
                        onClick={() => openFicha(operation.id)}
                      >
                        {hasOperationFicha(operation.produto, operation.ficha_portabilidade)
                          ? "Abrir ficha"
                          : "Sem ficha"}
                      </button>
                    </td>
                    <td>
                      <span className={`operationStatusBadge ${normalizedStatus}`}>
                        {formatStatus(normalizedStatus)}
                      </span>
                    </td>
                    <td>{operation.pendencia_motivo || "-"}</td>
                    <td>{operation.pendencia_resposta_vendedor || "-"}</td>
                    <td>
                      <div className="operationTableActions">
                        {canEdit && (
                          <button
                            type="button"
                            className="clientGhostButton"
                            onClick={() => handleEdit(operation)}
                          >
                            {editingOperationId === operation.id ? "Editando" : "Editar"}
                          </button>
                        )}

                        {canRespondPending && (
                          <button
                            type="button"
                            className="clientGhostButton"
                            onClick={() => handlePendingResponse(operation)}
                          >
                            Responder pendência
                          </button>
                        )}

                        {canSend && (
                          <button
                            type="button"
                            className="clientPrimaryButton"
                            onClick={() => handleSend(operation.id)}
                          >
                            {normalizedStatus === "PENDENTE" ? "Enviar" : "Reenviar"}
                          </button>
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
