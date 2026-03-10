const ACCOUNT_TYPE_OPTIONS = [
  { value: "CORRENTE", label: "Corrente" },
  { value: "POUPANCA", label: "Poupança" },
  { value: "SALARIO", label: "Salário" },
];

const BANK_LABELS = [
  "C6 BANK",
  "BMG",
  "FACTA",
  "PAN",
  "DAYCOVAL",
  "BRB",
  "PICPAY",
  "FINANTO",
  "QUERO +",
  "CAPITAL",
  "BANRISUL",
  "NOSSA FINTECH",
];

const BANK_OPTIONS = BANK_LABELS.map((bank) => ({ value: bank, label: bank }));

const BANK_CANONICAL_BY_KEY = BANK_LABELS.reduce((acc, label) => {
  acc.set(String(label).trim().toUpperCase(), label);
  return acc;
}, new Map());

BANK_CANONICAL_BY_KEY.set("C6", "C6 BANK");
BANK_CANONICAL_BY_KEY.set("C6BANK", "C6 BANK");

function normalizeBankValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const key = raw.toUpperCase().replace(/\s+/g, " ");
  const compactKey = key.replace(/\s+/g, "");

  return (
    BANK_CANONICAL_BY_KEY.get(key) ||
    BANK_CANONICAL_BY_KEY.get(compactKey) ||
    raw
  );
}

export const OPERATION_SCHEMAS = {
  PORTABILIDADE: {
    title: "Ficha para Portabilidade",
    groups: [
      {
        title: "Dados gerais",
        fields: [
          { name: "vendedor_nome", label: "Nome do vendedor", required: true },
          {
            name: "banco_nome",
            label: "Banco pra digitar",
            required: true,
            options: BANK_OPTIONS,
          },
          { name: "cliente_negativo", label: "Negativo do cliente (se tiver)" },
        ],
      },
      {
        title: "Dados do beneficiário",
        fields: [
          { name: "cliente_nome", label: "Nome", required: true },
          { name: "especie", label: "Espécie", required: true },
          { name: "uf_beneficio", label: "UF do benefício", required: true },
          { name: "numero_beneficio", label: "Número do benefício", required: true },
          { name: "data_nascimento", label: "Data de nascimento", type: "date", required: true },
          { name: "cpf", label: "CPF", required: true },
          { name: "rg", label: "RG", required: true },
          { name: "data_emissao", label: "Data emissão", type: "date" },
          { name: "nome_mae", label: "Nome da mãe", required: true },
          { name: "telefone", label: "Telefone", required: true },
          { name: "email", label: "E-mail (opcional)", type: "email" },
          { name: "analfabeto", label: "Analfabeto", readOnly: true, hideWhenEmpty: true },
          { name: "cep", label: "CEP", required: true },
          { name: "endereco", label: "Endereço", required: true },
          { name: "bairro", label: "Bairro", required: true },
        ],
      },
      {
        title: "Dados bancários",
        fields: [
          { name: "conta", label: "Banco do cliente", required: true },
          { name: "agencia", label: "Agência", required: true },
          {
            name: "banco",
            label: "Nº da conta do cliente",
            required: true,
            inputMode: "numeric",
            placeholder: "Ex: 12345-6",
          },
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
          { name: "saldo_quitacao", label: "Saldo de quitação", type: "number", min: 0, step: "0.01", required: true },
          { name: "valor_parcela", label: "Valor da parcela", type: "number", min: 0, step: "0.01", required: true },
          { name: "prazo", label: "Prazo", type: "number", min: 0 },
          {
            name: "margem",
            label: "Margem",
            type: "text",
            inputMode: "decimal",
            decimalFlexible: true,
            placeholder: "0,00",
          },
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
          {
            name: "banco_para_digitar",
            label: "Banco pra digitar",
            required: true,
            options: BANK_OPTIONS,
          },
          { name: "vendedor_nome", label: "Nome do vendedor", required: true },
          {
            name: "margem",
            label: "Margem",
            type: "text",
            inputMode: "decimal",
            decimalFlexible: true,
            placeholder: "0,00",
            required: true,
          },
          { name: "prazo", label: "Prazo", type: "number", min: 0, required: true },
        ],
      },
      {
        title: "Dados do beneficiário",
        fields: [
          { name: "especie", label: "Espécie", required: true },
          { name: "uf_beneficio", label: "UF do benefício", required: true },
          { name: "cliente_nome", label: "Nome", required: true },
          { name: "cpf", label: "CPF", required: true },
          { name: "data_nascimento", label: "Data de nascimento", type: "date", required: true },
          { name: "numero_beneficio", label: "Número do benefício", required: true },
          { name: "telefone", label: "Telefone", required: true },
          { name: "nome_mae", label: "Nome da mãe", required: true },
          { name: "analfabeto", label: "Analfabeto", readOnly: true, hideWhenEmpty: true },
          { name: "rg", label: "Número do RG", required: true },
          { name: "naturalidade", label: "Naturalidade", required: true },
          { name: "rg_uf", label: "UF", required: true },
          { name: "rg_orgao_exp", label: "Órgão exp", required: true },
          { name: "data_emissao_rg", label: "Data emissão RG", type: "date", required: true },
          {
            name: "salario",
            label: "Salário",
            type: "text",
            inputMode: "decimal",
            decimalFlexible: true,
            placeholder: "0,00",
            required: true,
          },
        ],
      },
      {
        title: "Dados bancários",
        fields: [
          { name: "conta", label: "Banco do cliente", required: true },
          { name: "agencia", label: "Agência", required: true },
          {
            name: "banco",
            label: "Nº da conta do cliente",
            required: true,
            inputMode: "numeric",
            placeholder: "Ex: 12345-6",
          },
          {
            name: "tipo_conta",
            label: "Tipo de conta",
            required: true,
            options: ACCOUNT_TYPE_OPTIONS,
          },
        ],
      },
      {
        title: "Endereço",
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
    title: "Ficha para Cartão",
    groups: [
      {
        title: "Dados gerais",
        fields: [
          { name: "titulo_produto", label: "Produto", required: true },
          { name: "vendedor_nome", label: "Nome do vendedor", required: true },
          {
            name: "banco_para_digitar",
            label: "Banco pra digitar",
            required: true,
            options: BANK_OPTIONS,
          },
          {
            name: "margem",
            label: "Margem",
            type: "text",
            inputMode: "decimal",
            decimalFlexible: true,
            placeholder: "0,00",
            required: true,
          },
          { name: "prazo", label: "Prazo", type: "number", min: 0 },
        ],
      },
      {
        title: "Dados do beneficiário",
        fields: [
          { name: "especie", label: "Espécie", required: true },
          { name: "uf_beneficio", label: "UF do benefício", required: true },
          { name: "cliente_nome", label: "Nome", required: true },
          { name: "cpf", label: "CPF", required: true },
          { name: "data_nascimento", label: "Data de nascimento", type: "date", required: true },
          { name: "numero_beneficio", label: "Número do benefício", required: true },
          { name: "telefone", label: "Telefone", required: true },
          { name: "nome_mae", label: "Nome da mãe", required: true },
          { name: "analfabeto", label: "Analfabeto", readOnly: true, hideWhenEmpty: true },
          { name: "rg", label: "Número do RG", required: true },
          { name: "naturalidade", label: "Naturalidade", required: true },
          { name: "rg_uf", label: "UF", required: true },
          { name: "rg_orgao_exp", label: "Órgão exp", required: true },
          { name: "data_emissao_rg", label: "Data emissão RG", type: "date", required: true },
          {
            name: "salario",
            label: "Salário",
            type: "text",
            inputMode: "decimal",
            decimalFlexible: true,
            placeholder: "0,00",
            required: true,
          },
        ],
      },
      {
        title: "Dados bancários",
        fields: [
          { name: "conta", label: "Banco do cliente", required: true },
          { name: "agencia", label: "Agência", required: true },
          {
            name: "banco",
            label: "Nº da conta do cliente",
            required: true,
            inputMode: "numeric",
            placeholder: "Ex: 12345-6",
          },
          {
            name: "tipo_conta",
            label: "Tipo de conta",
            required: true,
            options: ACCOUNT_TYPE_OPTIONS,
          },
        ],
      },
      {
        title: "Endereço",
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

export function parseOperationFicha(payload, product = "") {
  if (!payload) return {};

  if (typeof payload === "string") {
    try {
      return normalizeLegacyOperationFields(product, JSON.parse(payload) || {});
    } catch {
      return {};
    }
  }

  return typeof payload === "object"
    ? normalizeLegacyOperationFields(product, payload)
    : {};
}

function normalizeLegacyOperationFields(product, payload) {
  const upperProduct = toUpperProduct(product);
  if (upperProduct !== "NOVO" && upperProduct !== "CARTAO") {
    return payload;
  }

  if (!payload || typeof payload !== "object") {
    return payload;
  }

  const normalized = { ...payload };
  const legacyBankCode = String(payload.banco_codigo || "").trim();
  const accountNumber = String(payload.banco || "").trim();

  if (legacyBankCode && !accountNumber) {
    normalized.banco = String(payload.conta || "").trim();
    normalized.conta = "";
  }

  if (
    upperProduct === "CARTAO" &&
    String(normalized.titulo_produto || "").trim().toUpperCase() === "CARTAO RCC AMIGOZ"
  ) {
    normalized.titulo_produto = "CARTAO RCC";
  }

  return normalized;
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

  const text = String(value).trim();
  const isoDateMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDateMatch) {
    return `${isoDateMatch[1]}-${isoDateMatch[2]}-${isoDateMatch[3]}`;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateForDisplay(value) {
  const text = String(value || "").trim();
  if (!text) return "-";

  const isoDateMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDateMatch) {
    return `${isoDateMatch[3]}/${isoDateMatch[2]}/${isoDateMatch[1]}`;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return text;

  return date.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

export function buildOperationFichaDefaults(product, client, user, seed = {}) {
  const upperProduct = toUpperProduct(product);
  const normalizedSeedBank = normalizeBankValue(seed.banco_digitacao);

  return {
    vendedor_nome: client?.vendedor_nome || user?.nome || "",
    banco_nome: normalizedSeedBank,
    banco_para_digitar: normalizedSeedBank,
    banco: "",
    titulo_produto: upperProduct === "CARTAO" ? "CARTAO RCC" : "",
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
    email: client?.email || "",
    analfabeto: client?.analfabeto ? "Sim" : "",
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
  };
}

export function mergeOperationFicha(product, client, user, currentPayload, seed = {}) {
  const schema = getOperationSchema(product);
  if (!schema) return {};

  const defaults = buildOperationFichaDefaults(product, client, user, seed);
  const current = parseOperationFicha(currentPayload, product);
  const merged = {};

  schemaFieldNames(schema).forEach((name) => {
    const value = current[name] ?? defaults[name] ?? "";
    if (name === "vendedor_nome") {
      merged[name] = defaults[name] || value;
      return;
    }
    if (name === "banco_nome" || name === "banco_para_digitar") {
      merged[name] = normalizeBankValue(value);
      return;
    }
    if (name === "email") {
      const currentEmail = String(current[name] || "").trim().toLowerCase();
      const clientEmail = String(defaults[name] || "").trim().toLowerCase();
      const sellerEmail = String(user?.email || "").trim().toLowerCase();

      if (!currentEmail) {
        merged[name] = defaults[name] || "";
        return;
      }

      // Corrects old payloads that were seeded with the seller e-mail.
      if (clientEmail && currentEmail === sellerEmail && clientEmail !== sellerEmail) {
        merged[name] = defaults[name] || "";
        return;
      }
    }
    merged[name] = value;
  });

  return merged;
}

export function sanitizeOperationFicha(product, payload) {
  const schema = getOperationSchema(product);
  if (!schema) return null;

  const source = parseOperationFicha(payload, product);
  const result = {};
  let hasValue = false;

  schemaFieldNames(schema).forEach((name) => {
    const value = source[name];
    let text = value == null ? "" : String(value).trim();

    if (name === "banco_nome" || name === "banco_para_digitar") {
      text = normalizeBankValue(text);
    }

    result[name] = text;
    if (text) hasValue = true;
  });

  return hasValue ? result : null;
}

export function hasOperationFicha(product, payload) {
  return Boolean(sanitizeOperationFicha(product, payload));
}

function parseFlexibleNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const raw = String(value)
    .trim()
    .replace(/[^\d,.\-\s]/g, "");
  if (!raw) return null;

  const hasComma = raw.includes(",");
  const hasDot = raw.includes(".");
  const cleaned = raw.replace(/\s+/g, "");

  if (!hasComma && !hasDot) {
    const direct = Number(cleaned);
    return Number.isNaN(direct) ? null : direct;
  }

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  const decimalIndex = Math.max(lastComma, lastDot);

  const sign = cleaned.startsWith("-") ? "-" : "";
  const unsigned = sign ? cleaned.slice(1) : cleaned;
  const unsignedDecimalIndex = decimalIndex - (sign ? 1 : 0);

  if (unsignedDecimalIndex < 0) {
    const direct = Number(cleaned.replace(/,/g, "."));
    return Number.isNaN(direct) ? null : direct;
  }

  const integerPart = unsigned.slice(0, unsignedDecimalIndex).replace(/[.,]/g, "");
  const decimalPart = unsigned.slice(unsignedDecimalIndex + 1).replace(/[.,]/g, "");
  const normalized = decimalPart
    ? `${sign}${integerPart || "0"}.${decimalPart}`
    : `${sign}${integerPart || "0"}`;

  const number = Number(normalized);
  return Number.isNaN(number) ? null : number;
}

function toNullableNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = parseFlexibleNumber(value);
    if (number !== null) return number;
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
    banco_digitacao: normalizeBankValue(
      toText(
        ficha.banco_para_digitar,
        ficha.banco_nome,
        ficha.banco_codigo,
        fallback.banco_digitacao
      )
    ),
    margem,
    prazo,
    ficha_portabilidade: Object.keys(ficha).length ? ficha : null,
  };
}

export function formatOperationFichaValue(value, type) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return "-";
  }

  if (type === "date") {
    return formatDateForDisplay(value);
  }

  return String(value);
}

