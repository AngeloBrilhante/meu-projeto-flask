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
  { value: "CARTAO", label: "Cartao" },
];

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
  return String(status || "PENDENTE").replaceAll("_", " ");
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
  const formSchema = getOperationSchema(form.produto);

  async function loadOperations() {
    try {
      const data = await listClientOperations(id);
      setOperations(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Erro ao carregar operacoes:", error);
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
      alert("Nao existe ficha configurada para este produto.");
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
        alert("Operacao editada com sucesso");
      } else {
        await createOperation(id, payload);
        alert("Operacao criada com sucesso");
      }

      resetForm("");
      await loadOperations();
    } catch (error) {
      console.error("Erro ao salvar operacao:", error);
      alert(error.message || "Nao foi possivel salvar a operacao");
    } finally {
      setLoading(false);
    }
  }

  async function handleSend(operationId) {
    try {
      await sendOperationToPipeline(operationId);
      await loadOperations();
      window.dispatchEvent(new Event("pipeline:changed"));
      alert("Operacao enviada para esteira");
    } catch (error) {
      alert(error.message || "Nao foi possivel enviar para esteira");
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
      <h2>Operacoes</h2>

      <form onSubmit={handleSubmit} className="operationsFormCard">
        <h3>{editingOperationId ? "Editar operacao" : "Nova operacao"}</h3>

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
            Selecione o produto para abrir a ficha especifica.
          </p>
        )}

        {form.produto && !formSchema && (
          <p className="operationFichaHint">
            Nao existe ficha configurada para este produto.
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
            {loading ? "Salvando..." : editingOperationId ? "Salvar edicao" : "Criar operacao"}
          </button>

          {editingOperationId && (
            <button
              type="button"
              className="clientGhostButton"
              onClick={() => resetForm("")}
            >
              Cancelar edicao
            </button>
          )}
        </div>
      </form>

      <h3>Operacoes cadastradas</h3>

      {sortedOperations.length === 0 ? (
        <p className="clientSectionText">Nenhuma operacao cadastrada.</p>
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
                <th>Acao</th>
              </tr>
            </thead>
            <tbody>
              {sortedOperations.map((operation) => (
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
                    <span className={`operationStatusBadge ${operation.status || "PENDENTE"}`}>
                      {formatStatus(operation.status)}
                    </span>
                  </td>
                  <td>
                    <div className="operationTableActions">
                      {(operation.status === "PENDENTE" || operation.status === "DEVOLVIDA") && (
                        <>
                          <button
                            type="button"
                            className="clientGhostButton"
                            onClick={() => handleEdit(operation)}
                          >
                            {editingOperationId === operation.id ? "Editando" : "Editar"}
                          </button>

                          <button
                            type="button"
                            className="clientPrimaryButton"
                            onClick={() => handleSend(operation.id)}
                          >
                            {operation.status === "DEVOLVIDA" ? "Reenviar" : "Enviar"}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
