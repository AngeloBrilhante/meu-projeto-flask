import { useEffect, useMemo, useState } from "react";
import { useOutletContext, useSearchParams, useParams } from "react-router-dom";
import { getApiUrl } from "../../config/api";
import {
  createOperation,
  listClientDocuments,
  listClientOperations,
  sendOperationToPipeline,
  updateOperation,
} from "../../services/api";

const API_URL = getApiUrl();

const SCHEMAS = {
  PORTABILIDADE: {
    title: "Ficha para Portabilidade",
    groups: [
      {
        title: "Dados gerais",
        fields: [
          { name: "vendedor_nome", label: "Nome do vendedor", required: true },
          { name: "banco_nome", label: "Nome do banco", required: true },
          { name: "cliente_negativo", label: "Negativo do cliente (se tiver)" },
        ],
      },
      {
        title: "Dados do beneficiario",
        fields: [
          { name: "cliente_nome", label: "Nome", required: true },
          { name: "especie", label: "Especie", required: true },
          { name: "uf_beneficio", label: "UF do beneficio", required: true },
          { name: "numero_beneficio", label: "Numero do beneficio", required: true },
          { name: "data_nascimento", label: "Data de nascimento", type: "date", required: true },
          { name: "cpf", label: "CPF", required: true },
          { name: "rg", label: "RG", required: true },
          { name: "data_emissao", label: "Data emissao", type: "date" },
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
          { name: "total_parcelas", label: "Total de parcelas", type: "number", min: 0, required: true },
          { name: "parcelas_pagas", label: "Parcelas pagas", type: "number", min: 0, required: true },
          { name: "parcelas_restantes", label: "Parcelas restantes", type: "number", min: 0, required: true },
          { name: "saldo_quitacao", label: "Saldo de quitacao", type: "number", min: 0, step: "0.01", required: true },
          { name: "valor_parcela", label: "Valor da parcela", type: "number", min: 0, step: "0.01", required: true },
        ],
      },
    ],
  },
  NOVO: {
    title: "Ficha para Novo",
    groups: [
      {
        title: "Dados gerais",
        fields: [
          { name: "banco_para_digitar", label: "Banco pra digitar", required: true },
          { name: "vendedor_nome", label: "Nome do vendedor", required: true },
        ],
      },
      {
        title: "Dados do beneficiario",
        fields: [
          { name: "especie", label: "Especie", required: true },
          { name: "uf_beneficio", label: "UF do beneficio", required: true },
          { name: "cliente_nome", label: "Nome", required: true },
          { name: "cpf", label: "CPF", required: true },
          { name: "data_nascimento", label: "Data de nascimento", type: "date", required: true },
          { name: "numero_beneficio", label: "Numero do beneficio", required: true },
          { name: "telefone", label: "Telefone", required: true },
          { name: "nome_mae", label: "Nome da mae", required: true },
          { name: "rg", label: "Numero do RG", required: true },
          { name: "naturalidade", label: "Naturalidade", required: true },
          { name: "rg_uf", label: "UF", required: true },
          { name: "rg_orgao_exp", label: "Orgao exp", required: true },
          { name: "data_emissao_rg", label: "Data emissao RG", type: "date", required: true },
          { name: "salario", label: "Salario", type: "number", min: 0, step: "0.01", required: true },
        ],
      },
      {
        title: "Dados bancarios",
        fields: [
          { name: "banco_codigo", label: "Cod banco", required: true },
          { name: "agencia", label: "Agencia", required: true },
          { name: "conta", label: "Conta", required: true },
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
        title: "Endereco",
        fields: [
          { name: "cep", label: "CEP", required: true },
          { name: "rua", label: "Rua", required: true },
          { name: "numero", label: "N", required: true },
          { name: "bairro", label: "Bairro", required: true },
        ],
      },
    ],
  },
  CARTAO: {
    title: "Ficha para Cartao",
    groups: [
      {
        title: "Dados gerais",
        fields: [
          { name: "titulo_produto", label: "Produto", required: true },
          { name: "vendedor_nome", label: "Nome do vendedor", required: true },
        ],
      },
      {
        title: "Dados do beneficiario",
        fields: [
          { name: "especie", label: "Especie", required: true },
          { name: "uf_beneficio", label: "UF do beneficio", required: true },
          { name: "cliente_nome", label: "Nome", required: true },
          { name: "cpf", label: "CPF", required: true },
          { name: "data_nascimento", label: "Data de nascimento", type: "date", required: true },
          { name: "numero_beneficio", label: "Numero do beneficio", required: true },
          { name: "telefone", label: "Telefone", required: true },
          { name: "nome_mae", label: "Nome da mae", required: true },
          { name: "rg", label: "Numero do RG", required: true },
          { name: "naturalidade", label: "Naturalidade", required: true },
          { name: "rg_uf", label: "UF", required: true },
          { name: "rg_orgao_exp", label: "Orgao exp", required: true },
          { name: "data_emissao_rg", label: "Data emissao RG", type: "date", required: true },
          { name: "salario", label: "Salario", type: "number", min: 0, step: "0.01", required: true },
        ],
      },
      {
        title: "Dados bancarios",
        fields: [
          { name: "banco_codigo", label: "Cod banco", required: true },
          { name: "agencia", label: "Agencia", required: true },
          { name: "conta", label: "Conta", required: true },
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
        title: "Endereco",
        fields: [
          { name: "cep", label: "CEP", required: true },
          { name: "rua", label: "Rua", required: true },
          { name: "numero", label: "N", required: true },
          { name: "bairro", label: "Bairro", required: true },
        ],
      },
    ],
  },
};

SCHEMAS.PORTABILIDADE_REFIN = SCHEMAS.PORTABILIDADE;

const EMPTY_FORM = {
  produto: "NOVO",
  banco_digitacao: "",
  valor_solicitado: "",
  prazo: "",
  margem: "",
  parcela_solicitada: "",
  ficha_portabilidade: {},
};

function getSchema(product) {
  return SCHEMAS[String(product || "").toUpperCase()] || null;
}

function parseFicha(payload) {
  if (!payload) return {};
  if (typeof payload === "string") {
    try {
      return JSON.parse(payload) || {};
    } catch {
      return {};
    }
  }
  return typeof payload === "object" ? payload : {};
}

function toInputDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function getFieldNames(schema) {
  const fields = [];
  schema?.groups?.forEach((group) => group.fields.forEach((field) => fields.push(field.name)));
  return fields;
}

function getDefaults(product, client, base) {
  const user = (() => {
    try {
      return JSON.parse(localStorage.getItem("usuario") || "null");
    } catch {
      return null;
    }
  })();

  const p = String(product || "").toUpperCase();
  return {
    vendedor_nome: user?.nome || "",
    banco_nome: base.banco_digitacao || "",
    banco_para_digitar: base.banco_digitacao || "",
    titulo_produto: p === "CARTAO" ? "CARTAO RCC AMIGOZ" : "",
    cliente_nome: client?.nome || "",
    especie: client?.especie || "",
    uf_beneficio: client?.uf_beneficio || "",
    numero_beneficio: client?.numero_beneficio || "",
    data_nascimento: toInputDate(client?.data_nascimento),
    cpf: client?.cpf || "",
    rg: client?.rg_numero || "",
    data_emissao: toInputDate(client?.rg_data_emissao),
    data_emissao_rg: toInputDate(client?.rg_data_emissao),
    nome_mae: client?.nome_mae || "",
    telefone: client?.telefone || "",
    email: user?.email || "",
    naturalidade: client?.naturalidade || "",
    rg_uf: client?.rg_uf || "",
    rg_orgao_exp: client?.rg_orgao_exp || "",
    salario: client?.salario == null ? "" : String(client.salario),
    cep: client?.cep || "",
    endereco: [client?.rua, client?.numero].filter(Boolean).join(", "),
    rua: client?.rua || "",
    numero: client?.numero || "",
    bairro: client?.bairro || "",
    tipo_conta: "CORRENTE",
    margem: base.margem || "",
    prazo: base.prazo || "",
  };
}

function mergeFicha(product, client, current, base) {
  const schema = getSchema(product);
  if (!schema) return {};
  const defaults = getDefaults(product, client, base);
  const parsed = parseFicha(current);
  const merged = {};
  getFieldNames(schema).forEach((name) => {
    merged[name] = parsed[name] ?? defaults[name] ?? "";
  });
  return merged;
}

function sanitizeFicha(product, payload) {
  const schema = getSchema(product);
  if (!schema) return null;
  const parsed = parseFicha(payload);
  const clean = {};
  let has = false;
  getFieldNames(schema).forEach((name) => {
    const value = parsed[name];
    const text = value == null ? "" : String(value).trim();
    clean[name] = text;
    if (text) has = true;
  });
  return has ? clean : null;
}

function formatCurrency(value) {
  const number = Number(value);
  if (Number.isNaN(number)) return "-";
  return number.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("pt-BR");
}

function formatValue(value, type) {
  if (!value) return "-";
  if (type === "date") return formatDate(value);
  return String(value);
}

export default function ClientOperations() {
  const { id } = useParams();
  const { client } = useOutletContext() || {};
  const [searchParams, setSearchParams] = useSearchParams();

  const [operations, setOperations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editingOperationId, setEditingOperationId] = useState(null);
  const [selectedOperationId, setSelectedOperationId] = useState(null);
  const [viewerDocuments, setViewerDocuments] = useState([]);
  const [viewerDocsLoading, setViewerDocsLoading] = useState(false);
  const [form, setForm] = useState(() => ({ ...EMPTY_FORM, ficha_portabilidade: mergeFicha("NOVO", client, null, EMPTY_FORM) }));

  const selectedOperation = useMemo(() => operations.find((op) => op.id === selectedOperationId) || null, [operations, selectedOperationId]);
  const formSchema = getSchema(form.produto);
  const selectedSchema = getSchema(selectedOperation?.produto);
  const selectedFicha = sanitizeFicha(selectedOperation?.produto, selectedOperation?.ficha_portabilidade);

  async function loadOperations() {
    try {
      const data = await listClientOperations(id);
      setOperations(Array.isArray(data) ? data : []);
    } catch {
      setOperations([]);
    }
  }

  useEffect(() => {
    if (id) loadOperations();
  }, [id]);

  useEffect(() => {
    const opId = Number(searchParams.get("operation"));
    const view = String(searchParams.get("view") || "").toLowerCase();
    if (opId && view === "ficha" && operations.some((op) => op.id === opId)) setSelectedOperationId(opId);
  }, [operations, searchParams]);

  useEffect(() => {
    if (!selectedOperationId) return;
    let cancelled = false;
    async function loadDocs() {
      try {
        setViewerDocsLoading(true);
        const data = await listClientDocuments(id);
        if (!cancelled) setViewerDocuments(Array.isArray(data?.documents) ? data.documents : []);
      } finally {
        if (!cancelled) setViewerDocsLoading(false);
      }
    }
    loadDocs();
    return () => {
      cancelled = true;
    };
  }, [id, selectedOperationId]);

  function setFichaByProduct(nextProduct, prevForm, currentPayload) {
    return mergeFicha(nextProduct, client, currentPayload, prevForm);
  }

  function handleChange(event) {
    const { name, value } = event.target;
    if (name === "produto") {
      setForm((prev) => {
        const next = { ...prev, produto: value };
        next.ficha_portabilidade = setFichaByProduct(value, next, prev.ficha_portabilidade);
        return next;
      });
      return;
    }

    if (name === "banco_digitacao") {
      setForm((prev) => {
        const next = { ...prev, banco_digitacao: value };
        next.ficha_portabilidade = setFichaByProduct(prev.produto, next, prev.ficha_portabilidade);
        return next;
      });
      return;
    }

    setForm((prev) => ({ ...prev, [name]: value }));
  }

  function handleFichaChange(event) {
    const { name, value } = event.target;
    setForm((prev) => {
      const ficha = { ...prev.ficha_portabilidade, [name]: value };
      const next = { ...prev, ficha_portabilidade: ficha };
      if (name === "margem") next.margem = value;
      if (name === "prazo") next.prazo = value;
      return next;
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    try {
      const ficha = sanitizeFicha(form.produto, form.ficha_portabilidade);
      const payload = {
        produto: form.produto,
        banco_digitacao: form.banco_digitacao,
        valor_solicitado: form.valor_solicitado,
        prazo: form.prazo || ficha?.prazo || null,
        margem: form.margem || ficha?.margem || null,
        parcela_solicitada: form.parcela_solicitada,
        ficha_portabilidade: ficha,
      };

      if (editingOperationId) {
        await updateOperation(editingOperationId, payload);
      } else {
        await createOperation(id, payload);
      }

      setEditingOperationId(null);
      setForm({ ...EMPTY_FORM, ficha_portabilidade: mergeFicha("NOVO", client, null, EMPTY_FORM) });
      await loadOperations();
    } catch (error) {
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
    } catch (error) {
      alert(error.message || "Nao foi possivel enviar para esteira");
    }
  }

  function handleEdit(operation) {
    setEditingOperationId(operation.id);
    const next = {
      produto: operation.produto ?? "NOVO",
      banco_digitacao: operation.banco_digitacao ?? "",
      valor_solicitado: operation.valor_solicitado ?? "",
      prazo: operation.prazo ?? "",
      margem: operation.margem ?? "",
      parcela_solicitada: operation.parcela_solicitada ?? "",
    };
    setForm({ ...next, ficha_portabilidade: mergeFicha(next.produto, client, operation.ficha_portabilidade, next) });
  }

  function openFicha(operationId) {
    setSelectedOperationId(operationId);
    const next = new URLSearchParams(searchParams);
    next.set("operation", String(operationId));
    next.set("view", "ficha");
    setSearchParams(next);
  }

  function closeFicha() {
    setSelectedOperationId(null);
    const next = new URLSearchParams(searchParams);
    next.delete("operation");
    next.delete("view");
    setSearchParams(next);
  }

  const visibleOperations = useMemo(() => {
    return [...operations].sort((a, b) => {
      const da = new Date(a.criado_em || 0).getTime();
      const db = new Date(b.criado_em || 0).getTime();
      return db - da;
    });
  }, [operations]);

  return (
    <div className="clientSection">
      <h2>Operacoes</h2>
      <p className="clientSectionText">Cadastro, edicao e envio para a esteira.</p>

      <form onSubmit={handleSubmit} className="operationsFormCard">
        <h3>{editingOperationId ? "Editar operacao" : "Nova operacao"}</h3>

        <div className="operationsGrid">
          <label className="operationsField"><span>Produto</span><select name="produto" value={form.produto} onChange={handleChange} required><option value="NOVO">Novo</option><option value="PORTABILIDADE">Portabilidade</option><option value="REFINANCIAMENTO">Refinanciamento</option><option value="PORTABILIDADE_REFIN">Port + Refin</option><option value="CARTAO">Cartao</option></select></label>
          <label className="operationsField"><span>Banco digitacao</span><input type="text" name="banco_digitacao" value={form.banco_digitacao} onChange={handleChange} required /></label>
          <label className="operationsField"><span>Valor solicitado</span><input type="number" name="valor_solicitado" value={form.valor_solicitado} onChange={handleChange} required /></label>
          <label className="operationsField"><span>Prazo (meses)</span><input type="number" name="prazo" value={form.prazo} onChange={handleChange} /></label>
          <label className="operationsField"><span>Margem</span><input type="number" name="margem" value={form.margem} onChange={handleChange} /></label>
          <label className="operationsField"><span>Parcela solicitada</span><input type="number" name="parcela_solicitada" value={form.parcela_solicitada} onChange={handleChange} /></label>
        </div>

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
                          <select name={field.name} value={value} onChange={handleFichaChange} required={field.required}>
                            {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                          </select>
                        ) : (
                          <input type={field.type || "text"} name={field.name} value={value} min={field.min} step={field.step} onChange={handleFichaChange} required={field.required} />
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
          <button type="submit" className="clientPrimaryButton" disabled={loading}>{loading ? "Salvando..." : editingOperationId ? "Salvar edicao" : "Criar operacao"}</button>
          {editingOperationId && <button type="button" className="clientGhostButton" onClick={() => { setEditingOperationId(null); setForm({ ...EMPTY_FORM, ficha_portabilidade: mergeFicha("NOVO", client, null, EMPTY_FORM) }); }}>Cancelar edicao</button>}
        </div>
      </form>

      <h3>Operacoes cadastradas</h3>
      {visibleOperations.length === 0 ? (
        <p className="clientSectionText">Nenhuma operacao cadastrada.</p>
      ) : (
        <div className="operationsTableWrap">
          <table className="operationsTable">
            <thead><tr><th>Produto</th><th>Banco</th><th>Valor</th><th>Prazo</th><th>Ficha</th><th>Status</th><th>Acao</th></tr></thead>
            <tbody>
              {visibleOperations.map((operation) => (
                <tr key={operation.id}>
                  <td>{operation.produto}</td>
                  <td>{operation.banco_digitacao}</td>
                  <td>{formatCurrency(operation.valor_solicitado)}</td>
                  <td>{operation.prazo || "-"}</td>
                  <td><button type="button" className="clientGhostButton" onClick={() => openFicha(operation.id)}>{sanitizeFicha(operation.produto, operation.ficha_portabilidade) ? "Ver ficha" : "Sem ficha"}</button></td>
                  <td><span className={`operationStatusBadge ${operation.status || "PENDENTE"}`}>{String(operation.status || "PENDENTE").replaceAll("_", " ")}</span></td>
                  <td>
                    <div className="operationTableActions">
                      {(operation.status === "PENDENTE" || operation.status === "DEVOLVIDA") && (
                        <>
                          <button type="button" className="clientGhostButton" onClick={() => handleEdit(operation)}>{editingOperationId === operation.id ? "Editando" : "Editar"}</button>
                          <button type="button" className="clientPrimaryButton" onClick={() => handleSend(operation.id)}>{operation.status === "DEVOLVIDA" ? "Reenviar" : "Enviar"}</button>
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

      {selectedOperation && (
        <section className="operationViewerCard">
          <div className="operationViewerHeader">
            <div>
              <h3>Ficha da operacao #{selectedOperation.id} - {selectedOperation.produto}</h3>
              <p>Cliente: {client?.nome || "-"} | CPF: {client?.cpf || "-"}</p>
            </div>
            <button type="button" className="clientGhostButton" onClick={closeFicha}>Fechar ficha</button>
          </div>

          {selectedSchema && selectedFicha ? (
            <div className="operationViewerFicha">
              {selectedSchema.groups.map((group) => (
                <div key={group.title} className="operationViewerGroup">
                  <h4>{group.title}</h4>
                  <div className="operationViewerGrid">
                    {group.fields.map((field) => (
                      <article key={field.name}><span>{field.label}</span><strong>{formatValue(selectedFicha[field.name], field.type)}</strong></article>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="clientSectionText">Esta operacao nao possui ficha cadastrada.</p>
          )}

          <div className="operationViewerDocuments">
            <h4>Documentos do cliente</h4>
            {viewerDocsLoading ? (
              <p className="clientSectionText">Carregando documentos...</p>
            ) : viewerDocuments.length === 0 ? (
              <p className="clientSectionText">Nenhum documento enviado.</p>
            ) : (
              <ul className="operationViewerDocsList">
                {viewerDocuments.map((doc) => (
                  <li key={doc.filename} className="operationViewerDocItem">
                    <div><strong>{doc.type || "ARQUIVO"}</strong><span>{doc.filename}</span><small>{doc.uploaded_at || "-"}</small></div>
                    <a className="clientLinkButton" href={`${API_URL}/clients/${id}/documents/${encodeURIComponent(doc.filename)}`} target="_blank" rel="noreferrer">Abrir</a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
