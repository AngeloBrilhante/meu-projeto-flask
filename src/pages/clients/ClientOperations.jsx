import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  listClientOperations,
  createOperation,
  sendOperationToPipeline,
  updateOperation,
} from "../../services/api";

const EMPTY_FORM = {
  produto: "NOVO",
  banco_digitacao: "",
  valor_solicitado: "",
  prazo: "",
  margem: "",
  parcela_solicitada: "",
};

function toOperationForm(operation) {
  return {
    produto: operation.produto ?? "NOVO",
    banco_digitacao: operation.banco_digitacao ?? "",
    valor_solicitado: operation.valor_solicitado ?? "",
    prazo: operation.prazo ?? "",
    margem: operation.margem ?? "",
    parcela_solicitada: operation.parcela_solicitada ?? "",
  };
}

function getOperationDate(operation) {
  return operation.criado_em || operation.created_at || operation.createdAt;
}

function formatCurrency(value) {
  const number = Number(value);
  if (Number.isNaN(number)) return "-";
  return number.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function getStatusClass(status) {
  return status || "PENDENTE";
}

function getStatusLabel(status) {
  return String(status || "PENDENTE").replaceAll("_", " ");
}

export default function ClientOperations() {
  const { id } = useParams();

  const [operations, setOperations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [sortOrder, setSortOrder] = useState("desc");
  const [editingOperationId, setEditingOperationId] = useState(null);
  const [form, setForm] = useState(() => ({ ...EMPTY_FORM }));

  const isEditing = editingOperationId !== null;

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
    if (id) {
      loadOperations();
    }
  }, [id]);

  function resetForm() {
    setForm({ ...EMPTY_FORM });
    setEditingOperationId(null);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);

    try {
      if (isEditing) {
        await updateOperation(editingOperationId, form);
        alert("Operacao editada com sucesso");
      } else {
        await createOperation(id, form);
        alert("Operacao criada com sucesso");
      }

      resetForm();
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
      window.dispatchEvent(new Event("pipeline:changed"));
      await loadOperations();
      alert("Operacao enviada para esteira");
    } catch (error) {
      console.error("Erro ao enviar para esteira:", error);
      alert(error.message || "Nao foi possivel enviar para esteira");
    }
  }

  function handleEdit(operation) {
    setEditingOperationId(operation.id);
    setForm(toOperationForm(operation));
  }

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  const filteredOperations = useMemo(
    () =>
      operations
        .filter((op) =>
          Object.values(op)
            .join(" ")
            .toLowerCase()
            .includes(filter.toLowerCase())
        )
        .sort((a, b) => {
          const dateA = getOperationDate(a);
          const dateB = getOperationDate(b);

          if (!dateA || !dateB) return 0;

          return sortOrder === "desc"
            ? new Date(dateB) - new Date(dateA)
            : new Date(dateA) - new Date(dateB);
        }),
    [operations, filter, sortOrder]
  );

  return (
    <div className="clientSection">
      <h2>Operacoes</h2>
      <p className="clientSectionText">Cadastro, edicao e envio para a esteira.</p>

      <form onSubmit={handleSubmit} className="operationsFormCard">
        <h3>{isEditing ? "Editar operacao" : "Nova operacao"}</h3>

        <div className="operationsGrid">
          <label className="operationsField">
            <span>Produto</span>
            <select
              name="produto"
              value={form.produto}
              onChange={handleChange}
              required
            >
              <option value="NOVO">Novo</option>
              <option value="PORTABILIDADE">Portabilidade</option>
              <option value="REFINANCIAMENTO">Refinanciamento</option>
              <option value="PORTABILIDADE_REFIN">Port + Refin</option>
              <option value="CARTAO">Cartao</option>
            </select>
          </label>

          <label className="operationsField">
            <span>Banco digitacao</span>
            <input
              type="text"
              name="banco_digitacao"
              value={form.banco_digitacao}
              onChange={handleChange}
              required
            />
          </label>

          <label className="operationsField">
            <span>Valor solicitado</span>
            <input
              type="number"
              name="valor_solicitado"
              value={form.valor_solicitado}
              onChange={handleChange}
              required
            />
          </label>

          <label className="operationsField">
            <span>Prazo (meses)</span>
            <input
              type="number"
              name="prazo"
              value={form.prazo}
              onChange={handleChange}
              required
            />
          </label>

          <label className="operationsField">
            <span>Margem</span>
            <input
              type="number"
              name="margem"
              value={form.margem}
              onChange={handleChange}
            />
          </label>

          <label className="operationsField">
            <span>Parcela solicitada</span>
            <input
              type="number"
              name="parcela_solicitada"
              value={form.parcela_solicitada}
              onChange={handleChange}
            />
          </label>
        </div>

        <div className="operationsActions">
          <button type="submit" className="clientPrimaryButton" disabled={loading}>
            {loading
              ? "Salvando..."
              : isEditing
              ? "Salvar edicao"
              : "Criar operacao"}
          </button>

          {isEditing && (
            <button
              type="button"
              className="clientGhostButton"
              onClick={resetForm}
            >
              Cancelar edicao
            </button>
          )}
        </div>
      </form>

      <div className="operationsToolbar">
        <label className="operationsSearch">
          <input
            type="text"
            placeholder="Buscar operacao..."
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </label>

        <button
          type="button"
          className="clientGhostButton"
          onClick={() => setSortOrder(sortOrder === "desc" ? "asc" : "desc")}
        >
          Ordenar por data
        </button>
      </div>

      <h3>Operacoes cadastradas</h3>

      {filteredOperations.length === 0 ? (
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
                <th>Formalizacao</th>
                <th>Status</th>
                <th>Acao</th>
              </tr>
            </thead>
            <tbody>
              {filteredOperations.map((operation) => (
                <tr key={operation.id}>
                  <td>{operation.produto}</td>
                  <td>{operation.banco_digitacao}</td>
                  <td>{formatCurrency(operation.valor_solicitado)}</td>
                  <td>{operation.prazo}</td>
                  <td>
                    {operation.link_formalizacao ? (
                      <a
                        className="clientLinkButton"
                        href={operation.link_formalizacao}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Abrir link
                      </a>
                    ) : (
                      <span className="operationTextMuted">Sem link</span>
                    )}
                  </td>
                  <td>
                    <span
                      className={`operationStatusBadge ${getStatusClass(operation.status)}`}
                    >
                      {getStatusLabel(operation.status)}
                    </span>
                  </td>
                  <td>
                    {(operation.status === "PENDENTE" ||
                      operation.status === "DEVOLVIDA") && (
                      <div className="operationTableActions">
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
                          {operation.status === "DEVOLVIDA"
                            ? "Reenviar para esteira"
                            : "Enviar para esteira"}
                        </button>
                      </div>
                    )}

                    {operation.status === "EM_ANALISE" && (
                      <span className="operationTextMuted">Em analise</span>
                    )}
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
