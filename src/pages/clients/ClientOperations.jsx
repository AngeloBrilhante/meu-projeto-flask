import { useEffect, useMemo, useState } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import {
  listClientOperations,
  createOperation,
  sendOperationToPipeline,
  updateOperation,
} from "../../services/api";

const PORTABILITY_PRODUCTS = new Set(["PORTABILIDADE", "PORTABILIDADE_REFIN"]);

const EMPTY_PORTABILITY_FORM = {
  vendedor_nome: "",
  banco_nome: "",
  cliente_negativo: "",
  cliente_nome: "",
  especie: "",
  uf_beneficio: "",
  numero_beneficio: "",
  data_nascimento: "",
  cpf: "",
  rg: "",
  data_emissao: "",
  nome_mae: "",
  telefone: "",
  email: "",
  cep: "",
  endereco: "",
  bairro: "",
  conta: "",
  agencia: "",
  banco: "",
  tipo_conta: "CORRENTE",
  banco_portado: "",
  contrato_portado: "",
  total_parcelas: "",
  parcelas_pagas: "",
  parcelas_restantes: "",
  saldo_quitacao: "",
  valor_parcela: "",
};

const PORTABILITY_FIELD_GROUPS = [
  {
    title: "Dados gerais",
    fields: [
      { name: "vendedor_nome", label: "Nome do vendedor", required: true },
      { name: "banco_nome", label: "Nome do banco", required: true },
      { name: "cliente_negativo", label: "Negativo do cliente (se tiver)" },
    ],
  },
  {
    title: "Dados do cliente",
    fields: [
      { name: "cliente_nome", label: "Nome", required: true },
      { name: "especie", label: "Especie", required: true },
      { name: "uf_beneficio", label: "UF do beneficio", required: true },
      { name: "numero_beneficio", label: "Numero do beneficio", required: true },
      {
        name: "data_nascimento",
        label: "Data de nascimento",
        type: "date",
        required: true,
      },
      { name: "cpf", label: "CPF", required: true },
      { name: "rg", label: "RG", required: true },
      {
        name: "data_emissao",
        label: "Data de emissao",
        type: "date",
        required: true,
      },
      { name: "nome_mae", label: "Nome da mae", required: true },
      { name: "telefone", label: "Telefone", required: true },
      { name: "email", label: "Email", type: "email" },
      { name: "cep", label: "CEP", required: true },
      { name: "endereco", label: "Endereco", required: true },
      { name: "bairro", label: "Bairro", required: true },
    ],
  },
  {
    title: "Dados bancarios",
    fields: [
      { name: "conta", label: "Conta", required: true },
      { name: "agencia", label: "Agencia", required: true },
      { name: "banco", label: "Banco", required: true },
      {
        name: "tipo_conta",
        label: "Tipo de conta",
        required: true,
        options: [
          { value: "CORRENTE", label: "Corrente" },
          { value: "POUPANCA", label: "Poupanca" },
          { value: "SALARIO", label: "Salario" },
        ],
      },
    ],
  },
  {
    title: "Dados para portar",
    fields: [
      { name: "banco_portado", label: "Banco portado", required: true },
      { name: "contrato_portado", label: "Contrato portado", required: true },
      {
        name: "total_parcelas",
        label: "Total de parcelas",
        type: "number",
        min: 0,
        required: true,
      },
      {
        name: "parcelas_pagas",
        label: "Parcelas pagas",
        type: "number",
        min: 0,
        required: true,
      },
      {
        name: "parcelas_restantes",
        label: "Parcelas restantes",
        type: "number",
        min: 0,
        required: true,
      },
      {
        name: "saldo_quitacao",
        label: "Saldo de quitacao",
        type: "number",
        min: 0,
        step: "0.01",
        required: true,
      },
      {
        name: "valor_parcela",
        label: "Valor da parcela",
        type: "number",
        min: 0,
        step: "0.01",
        required: true,
      },
    ],
  },
];

const EMPTY_FORM = {
  produto: "NOVO",
  banco_digitacao: "",
  valor_solicitado: "",
  prazo: "",
  margem: "",
  parcela_solicitada: "",
  ficha_portabilidade: { ...EMPTY_PORTABILITY_FORM },
};

function getStoredUser() {
  try {
    const raw = localStorage.getItem("usuario");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function toInputDate(value) {
  if (!value) return "";

  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return "";

  return date.toISOString().slice(0, 10);
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

function buildPortabilityForm(client, currentPayload = null) {
  const user = getStoredUser();
  const current = parsePortabilityForm(currentPayload) || {};

  const base = {
    ...EMPTY_PORTABILITY_FORM,
    vendedor_nome: user?.nome || "",
    cliente_nome: client?.nome || "",
    especie: client?.especie || "",
    uf_beneficio: client?.uf_beneficio || "",
    numero_beneficio: client?.numero_beneficio || "",
    data_nascimento: toInputDate(client?.data_nascimento),
    cpf: client?.cpf || "",
    rg: client?.rg_numero || "",
    data_emissao: toInputDate(client?.rg_data_emissao),
    nome_mae: client?.nome_mae || "",
    telefone: client?.telefone || "",
    email: user?.email || "",
    cep: client?.cep || "",
    endereco: [client?.rua, client?.numero].filter(Boolean).join(", "),
    bairro: client?.bairro || "",
  };

  for (const [key, value] of Object.entries(current)) {
    if (!(key in base)) continue;
    if (value === null || value === undefined) continue;

    const text = String(value);
    if (!text.trim()) continue;

    base[key] = text;
  }

  return base;
}

function toOperationForm(operation, client) {
  return {
    produto: operation.produto ?? "NOVO",
    banco_digitacao: operation.banco_digitacao ?? "",
    valor_solicitado: operation.valor_solicitado ?? "",
    prazo: operation.prazo ?? "",
    margem: operation.margem ?? "",
    parcela_solicitada: operation.parcela_solicitada ?? "",
    ficha_portabilidade: buildPortabilityForm(
      client,
      operation.ficha_portabilidade
    ),
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

function hasPortabilityData(payload) {
  const parsed = parsePortabilityForm(payload);
  if (!parsed) return false;
  return Object.values(parsed).some((value) => String(value || "").trim() !== "");
}

export default function ClientOperations() {
  const { id } = useParams();
  const outletContext = useOutletContext();
  const client = outletContext?.client || null;

  const [operations, setOperations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [sortOrder, setSortOrder] = useState("desc");
  const [editingOperationId, setEditingOperationId] = useState(null);
  const [form, setForm] = useState(() => ({
    ...EMPTY_FORM,
    ficha_portabilidade: buildPortabilityForm(client),
  }));

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

  useEffect(() => {
    if (editingOperationId !== null) return;

    setForm((prev) => ({
      ...prev,
      ficha_portabilidade: buildPortabilityForm(client, prev.ficha_portabilidade),
    }));
  }, [client, editingOperationId]);

  function resetForm() {
    setForm({
      ...EMPTY_FORM,
      ficha_portabilidade: buildPortabilityForm(client),
    });
    setEditingOperationId(null);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);

    try {
      const payload = {
        ...form,
        ficha_portabilidade: isPortabilityProduct(form.produto)
          ? buildPortabilityForm(client, form.ficha_portabilidade)
          : null,
      };

      if (isEditing) {
        await updateOperation(editingOperationId, payload);
        alert("Operacao editada com sucesso");
      } else {
        await createOperation(id, payload);
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
    setForm(toOperationForm(operation, client));
  }

  function handleChange(event) {
    const { name, value } = event.target;

    if (name === "produto") {
      setForm((prev) => ({
        ...prev,
        produto: value,
        ficha_portabilidade: isPortabilityProduct(value)
          ? buildPortabilityForm(client, prev.ficha_portabilidade)
          : prev.ficha_portabilidade,
      }));
      return;
    }

    setForm((prev) => ({ ...prev, [name]: value }));
  }

  function handlePortabilityChange(event) {
    const { name, value } = event.target;

    setForm((prev) => {
      const nextPortability = {
        ...buildPortabilityForm(client, prev.ficha_portabilidade),
        [name]: value,
      };

      if (name === "total_parcelas" || name === "parcelas_pagas") {
        const total = Number(nextPortability.total_parcelas);
        const paid = Number(nextPortability.parcelas_pagas);

        if (!Number.isNaN(total) && !Number.isNaN(paid) && total >= paid) {
          nextPortability.parcelas_restantes = String(total - paid);
        }
      }

      return {
        ...prev,
        ficha_portabilidade: nextPortability,
      };
    });
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

        {isPortabilityProduct(form.produto) && (
          <section className="operationFichaCard">
            <h4>Ficha de Portabilidade</h4>

            {PORTABILITY_FIELD_GROUPS.map((group) => (
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
                            onChange={handlePortabilityChange}
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
                            onChange={handlePortabilityChange}
                            required={field.required}
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
                <th>Ficha</th>
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
                    {hasPortabilityData(operation.ficha_portabilidade) ? (
                      <span className="operationFichaReady">Preenchida</span>
                    ) : (
                      <span className="operationTextMuted">Sem ficha</span>
                    )}
                  </td>
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
