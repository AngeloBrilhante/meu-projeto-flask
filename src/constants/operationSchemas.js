const ACCOUNT_TYPE_OPTIONS = [
  { value: "CORRENTE", label: "Corrente" },
  { value: "POUPANCA", label: "Poupanca" },
  { value: "SALARIO", label: "Salario" },
];

export const OPERATION_SCHEMAS = {
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
            options: ACCOUNT_TYPE_OPTIONS,
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
          { name: "prazo", label: "Prazo", type: "number", min: 0 },
          { name: "margem", label: "Margem", type: "number", min: 0, step: "0.01" },
          { name: "valor_solicitado", label: "Valor solicitado", type: "number", min: 0, step: "0.01" },
          { name: "parcela_solicitada", label: "Parcela solicitada", type: "number", min: 0, step: "0.01" },
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
          { name: "valor_solicitado", label: "Valor solicitado", type: "number", min: 0, step: "0.01" },
          { name: "parcela_solicitada", label: "Parcela solicitada", type: "number", min: 0, step: "0.01" },
          { name: "margem", label: "Margem", type: "number", min: 0, step: "0.01", required: true },
          { name: "prazo", label: "Prazo", type: "number", min: 0, required: true },
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
            options: ACCOUNT_TYPE_OPTIONS,
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
          { name: "valor_solicitado", label: "Valor solicitado", type: "number", min: 0, step: "0.01" },
          { name: "parcela_solicitada", label: "Parcela solicitada", type: "number", min: 0, step: "0.01" },
          { name: "margem", label: "Margem", type: "number", min: 0, step: "0.01", required: true },
          { name: "prazo", label: "Prazo", type: "number", min: 0 },
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
            options: ACCOUNT_TYPE_OPTIONS,
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

OPERATION_SCHEMAS.PORTABILIDADE_REFIN = OPERATION_SCHEMAS.PORTABILIDADE;
OPERATION_SCHEMAS.REFINANCIAMENTO = OPERATION_SCHEMAS.PORTABILIDADE;

function toUpperProduct(product) {
  return String(product || "").trim().toUpperCase();
}

export function getOperationSchema(product) {
  return OPERATION_SCHEMAS[toUpperProduct(product)] || null;
}

export function parseOperationFicha(payload) {
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

export function schemaFieldNames(schema) {
  const names = [];

  schema?.groups?.forEach((group) => {
    group.fields.forEach((field) => names.push(field.name));
  });

  return names;
}

function parseDateForInput(value) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toISOString().slice(0, 10);
}

export function buildOperationFichaDefaults(product, client, user, seed = {}) {
  const upperProduct = toUpperProduct(product);

  return {
    vendedor_nome: user?.nome || "",
    banco_nome: seed.banco_digitacao || "",
    banco_para_digitar: seed.banco_digitacao || "",
    titulo_produto: upperProduct === "CARTAO" ? "CARTAO RCC AMIGOZ" : "",
    cliente_nome: client?.nome || "",
    especie: client?.especie || "",
    uf_beneficio: client?.uf_beneficio || "",
    numero_beneficio: client?.numero_beneficio || "",
    data_nascimento: parseDateForInput(client?.data_nascimento),
    cpf: client?.cpf || "",
    rg: client?.rg_numero || "",
    data_emissao: parseDateForInput(client?.rg_data_emissao),
    data_emissao_rg: parseDateForInput(client?.rg_data_emissao),
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
    margem: seed.margem || "",
    prazo: seed.prazo || "",
    valor_solicitado: seed.valor_solicitado || "",
    parcela_solicitada: seed.parcela_solicitada || "",
  };
}

export function mergeOperationFicha(product, client, user, currentPayload, seed = {}) {
  const schema = getOperationSchema(product);
  if (!schema) return {};

  const defaults = buildOperationFichaDefaults(product, client, user, seed);
  const current = parseOperationFicha(currentPayload);
  const merged = {};

  schemaFieldNames(schema).forEach((name) => {
    merged[name] = current[name] ?? defaults[name] ?? "";
  });

  return merged;
}

export function sanitizeOperationFicha(product, payload) {
  const schema = getOperationSchema(product);
  if (!schema) return null;

  const source = parseOperationFicha(payload);
  const result = {};
  let hasValue = false;

  schemaFieldNames(schema).forEach((name) => {
    const value = source[name];
    const text = value == null ? "" : String(value).trim();
    result[name] = text;
    if (text) hasValue = true;
  });

  return hasValue ? result : null;
}

export function hasOperationFicha(product, payload) {
  return Boolean(sanitizeOperationFicha(product, payload));
}

function toNullableNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (!Number.isNaN(number)) return number;
  }
  return null;
}

function toRequiredNumber(defaultValue, ...values) {
  const value = toNullableNumber(...values);
  if (value === null) return defaultValue;
  return value;
}

function toText(...values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

export function buildOperationPayloadFromFicha(product, fichaPayload, fallback = {}) {
  const ficha = sanitizeOperationFicha(product, fichaPayload) || {};
  const upperProduct = toUpperProduct(product);

  const prazo = toRequiredNumber(
    0,
    ficha.prazo,
    ficha.total_parcelas,
    fallback.prazo
  );
  const margem = toRequiredNumber(0, ficha.margem, fallback.margem);

  return {
    produto: upperProduct,
    banco_digitacao: toText(
      ficha.banco_para_digitar,
      ficha.banco_nome,
      ficha.banco_codigo,
      fallback.banco_digitacao,
      upperProduct
    ),
    margem,
    prazo,
    valor_solicitado: toNullableNumber(
      ficha.valor_solicitado,
      ficha.saldo_quitacao,
      fallback.valor_solicitado
    ),
    parcela_solicitada: toNullableNumber(
      ficha.parcela_solicitada,
      ficha.valor_parcela,
      fallback.parcela_solicitada
    ),
    ficha_portabilidade: Object.keys(ficha).length ? ficha : null,
  };
}

export function formatOperationFichaValue(value, type) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return "-";
  }

  if (type === "date") {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString("pt-BR");
  }

  return String(value);
}
