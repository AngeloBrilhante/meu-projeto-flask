import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { BANK_OPTIONS } from "../constants/operationSchemas";
import {
  getOperationStatusHistory,
  getPipeline,
  sendOperationToPipeline,
  updateOperation,
} from "../services/api";
import {
  DATE_INPUT_PLACEHOLDER,
  formatDateInputValue,
  normalizeDateInputValue,
  parseDateFilterBoundary,
} from "../utils/date";
import "./Pipeline.css";

const STATUS_LABELS = {
  PRONTA_DIGITAR: "Pronta para digitar",
  EM_DIGITACAO: "Em digitacao",
  AGUARDANDO_FORMALIZACAO: "Aguardando formalizacao",
  ANALISE_BANCO: "Analise do banco",
  PENDENCIA: "Pendencia",
  DEVOLVIDA_VENDEDOR: "Devolvida para vendedor",
  APROVADO: "Paga",
  REPROVADO: "Reprovada",
};

const PIPELINE_VIEW_OPTIONS = {
  ACTIVE: "ACTIVE",
  READY: "READY",
};

const LEGACY_STATUS_MAP = {
  PENDENTE: "PRONTA_DIGITAR",
  ENVIADA_ESTEIRA: "PRONTA_DIGITAR",
  FORMALIZADA: "ANALISE_BANCO",
  EM_ANALISE_BANCO: "ANALISE_BANCO",
  PENDENTE_BANCO: "PENDENCIA",
  EM_TRATATIVA_VENDEDOR: "DEVOLVIDA_VENDEDOR",
  REENVIADA_BANCO: "ANALISE_BANCO",
  EM_ANALISE: "ANALISE_BANCO",
  DEVOLVIDA: "DEVOLVIDA_VENDEDOR",
};

const PENDENCIA_TYPE_OPTIONS = [
  { value: "", label: "Tipo de pendencia" },
  { value: "DOCUMENTACAO", label: "Documentacao" },
  { value: "ASSINATURA", label: "Assinatura" },
  { value: "CARTA_PERICIA", label: "Carta pericia" },
  { value: "CHAMADA_DE_VIDEO", label: "Chamada de video" },
  { value: "MARGEM", label: "Margem" },
  { value: "BENEFICIO_BLOQUEADO", label: "Beneficio bloqueado" },
  { value: "DIVERGENCIA_CADASTRAL", label: "Divergencia cadastral" },
  { value: "OUTROS", label: "Outros" },
];

const REPROVACAO_REASON_OPTIONS = [
  { value: "", label: "Selecione o motivo da reprovacao" },
  { value: "MARGEM_INSUFICIENTE", label: "Margem insuficiente" },
  { value: "DOCUMENTACAO_INVALIDA", label: "Documentacao invalida" },
  { value: "DIVERGENCIA_CADASTRAL", label: "Divergencia cadastral" },
  { value: "POLITICA_BANCO", label: "Politica do banco" },
  { value: "DESISTENCIA_CLIENTE", label: "Desistencia do cliente" },
  { value: "OUTROS", label: "Outros" },
];

const PROMOTORA_OPTIONS = [
  { value: "", label: "Promotora (opcional)" },
  { value: "AMF", label: "AMF" },
  { value: "FINANBANK", label: "FINANBANK" },
  { value: "PROSPECTA", label: "PROSPECTA" },
  { value: "IDEIA", label: "IDEIA" },
  { value: "NEXTER", label: "NEXTER" },
  { value: "PONTO AMIGO", label: "PONTO AMIGO" },
  { value: "PORT", label: "PORT" },
];

const STATUS_ANDAMENTO_OPTIONS = [
  { value: "", label: "Sem andamento" },
  { value: "AGUARDANDO_SALDO", label: "Aguardando saldo" },
  { value: "ANALISE_DE_CREDITO", label: "Analise de credito" },
  { value: "ANALISE_DOCUMENTAL", label: "Analise documental" },
  { value: "ANALISE_DE_SELFIE", label: "Analise de selfie" },
  {
    value: "ANALISE_DE_FORMALIZACAO",
    label: "Analise de formalizacao",
  },
  { value: "AGUARDANDO_AVERBACAO", label: "Aguardando averbacao" },
  { value: "BENEFICIO_BLOQUEADO", label: "Beneficio bloqueado" },
  {
    value: "AGUARDANDO_LIBERACAO_DA_PROMOTORA",
    label: "Aguardando liberacao da promotora",
  },
  {
    value: "ENVIADO_PARA_PAGAMENTO",
    label: "Enviado para pagamento",
  },
];

const STATUS_ANDAMENTO_LABELS = STATUS_ANDAMENTO_OPTIONS.reduce((acc, option) => {
  if (option.value) {
    acc[option.value] = option.label;
  }
  return acc;
}, {});

const SORT_ORDER_OPTIONS = {
  NEWEST_FIRST: "NEWEST_FIRST",
  OLDEST_FIRST: "OLDEST_FIRST",
};

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const READY_PIPELINE_STATUSES = new Set(["PRONTA_DIGITAR", "EM_DIGITACAO"]);
const PIPELINE_SCROLL_STORAGE_KEY = "pipeline:return-scroll";

function getPageScrollContainer() {
  if (typeof document === "undefined") return null;
  return document.querySelector(".pageContent");
}

function normalizeStatus(status) {
  const normalized = String(status || "").trim().toUpperCase();
  return LEGACY_STATUS_MAP[normalized] || normalized;
}

function getStatusLabel(status) {
  const normalized = normalizeStatus(status);
  return STATUS_LABELS[normalized] || normalized || "-";
}

function normalizeAndamentoStatus(status) {
  return String(status || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
}

function getAndamentoLabel(status) {
  const normalized = normalizeAndamentoStatus(status);
  if (!normalized) return "Sem andamento";
  return STATUS_ANDAMENTO_LABELS[normalized] || normalized.replaceAll("_", " ");
}

function getPipelineReferenceAt(operation) {
  return operation?.enviada_esteira_em || operation?.criado_em || "";
}

function usesProposalLabels(product) {
  const normalized = String(product || "").trim().toUpperCase();
  return normalized === "REFINANCIAMENTO";
}

function usesSaldoLabels(product) {
  const normalized = String(product || "").trim().toUpperCase();
  return (
    normalized === "PORTABILIDADE" ||
    normalized === "PORTABILIDADE_REFIN"
  );
}

function toDraft(operation) {
  return {
    banco_digitacao: operation.banco_digitacao || "",
    link_formalizacao: operation.link_formalizacao || "",
    numero_proposta: operation.numero_proposta || "",
    valor_liberado:
      operation.valor_liberado === null || operation.valor_liberado === undefined
        ? ""
        : String(operation.valor_liberado),
    troco:
      operation.troco === null || operation.troco === undefined
        ? ""
        : String(operation.troco),
    parcela_liberada:
      operation.parcela_liberada === null || operation.parcela_liberada === undefined
        ? ""
        : String(operation.parcela_liberada),
    promotora: operation.promotora || "",
    pendencia_tipo: operation.pendencia_tipo || "",
    pendencia_motivo: operation.pendencia_motivo || "",
    motivo_reprovacao: operation.motivo_reprovacao || "",
    status_andamento: operation.status_andamento || "",
    reprovacao_tipo: "",
  };
}

function toTimestamp(value) {
  const time = new Date(value || "").getTime();
  return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
}

function getPriorityMeta(createdAt, nowMs) {
  const createdMs = toTimestamp(createdAt);

  if (createdMs === Number.MAX_SAFE_INTEGER) {
    return {
      label: "-",
      tone: "green",
      createdMs,
    };
  }

  const elapsedMs = Math.max(0, nowMs - createdMs);
  const elapsedHours = elapsedMs / (60 * 60 * 1000);
  const elapsedMinutes = elapsedMs / (60 * 1000);
  let tone = "green";

  if (elapsedMs >= ONE_DAY_MS) {
    tone = "red";
  } else if (elapsedMs >= FIVE_HOURS_MS) {
    tone = "yellow";
  }

  let label = `${Math.max(1, Math.floor(elapsedMinutes))}m`;

  if (elapsedHours >= 24) {
    label = `${Math.floor(elapsedHours / 24)}d`;
  } else if (elapsedHours >= 1) {
    label = `${Math.floor(elapsedHours)}h`;
  }

  return {
    label,
    tone,
    createdMs,
  };
}

function formatDateTime(value) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleString("pt-BR");
}

function formatCurrency(value) {
  const number =
    typeof value === "string" ? parseFlexibleDecimalInput(value) : Number(value);
  if (!Number.isFinite(number)) return "-";
  return number.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function parseFlexibleDecimalInput(value) {
  const text = String(value ?? "").trim().replace(/\s+/g, "");
  if (!text) return Number.NaN;

  const commaIndex = text.lastIndexOf(",");
  const dotIndex = text.lastIndexOf(".");
  const separatorIndex = Math.max(commaIndex, dotIndex);
  const separator = separatorIndex >= 0 ? text[separatorIndex] : "";

  if (!separator) {
    const digitsOnly = text.replace(/[^\d-]/g, "");
    return digitsOnly ? Number(digitsOnly) : Number.NaN;
  }

  const beforeSeparator = text.slice(0, separatorIndex);
  const afterSeparator = text.slice(separatorIndex + 1);
  const separatorOccurrences = (text.match(/[.,]/g) || []).length;
  const onlyOneSeparator = separatorOccurrences === 1;
  const isThousandsSeparator =
    onlyOneSeparator &&
    afterSeparator.length === 3 &&
    /^\d+$/.test(beforeSeparator.replace(/^-/, "")) &&
    /^\d+$/.test(afterSeparator);

  if (isThousandsSeparator) {
    const digitsOnly = text.replace(/[.,]/g, "");
    return digitsOnly ? Number(digitsOnly) : Number.NaN;
  }

  const normalizedInteger = beforeSeparator.replace(/[.,]/g, "");
  const normalizedDecimal = afterSeparator.replace(/[.,]/g, "");
  const normalized = `${normalizedInteger || "0"}.${normalizedDecimal}`;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function formatHistoryTransition(item) {
  const nextLabel = getStatusLabel(item.next_status);

  if (!item.previous_status) {
    return nextLabel;
  }

  const previousLabel = getStatusLabel(item.previous_status);

  if (previousLabel === nextLabel) {
    return nextLabel;
  }

  return `${previousLabel} -> ${nextLabel}`;
}

function formatHistoryActor(item) {
  const name = String(item.changed_by_name || "").trim();
  const role = String(item.changed_by_role || "").trim().toUpperCase();
  const base = name && name !== "-" ? name : "Sistema";
  return role ? `${base} (${role})` : base;
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem("usuario") || "null");
  } catch {
    return null;
  }
}

function getPipelineViewFromPath(pathname) {
  const normalized = String(pathname || "").trim().toLowerCase();
  return normalized.endsWith("/pipeline/prontas")
    ? PIPELINE_VIEW_OPTIONS.READY
    : PIPELINE_VIEW_OPTIONS.ACTIVE;
}

export default function Pipeline() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const user = useMemo(() => getStoredUser(), []);
  const role = String(user?.role || "").toUpperCase();
  const isVendor = role === "VENDEDOR";
  const canAccessReadyPipeline = role === "ADMIN" || role === "GLOBAL" || role.startsWith("DIGITADOR");
  const [operations, setOperations] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(false);
  const [savingOperationId, setSavingOperationId] = useState(null);
  const [openEditors, setOpenEditors] = useState({});
  const [openAndamentoMenu, setOpenAndamentoMenu] = useState({});
  const [openHistory, setOpenHistory] = useState({});
  const [historyByOperation, setHistoryByOperation] = useState({});
  const [loadingHistoryOperationId, setLoadingHistoryOperationId] = useState(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const routePipelineView = useMemo(
    () => getPipelineViewFromPath(location.pathname),
    [location.pathname]
  );
  const routeSearchTerm = useMemo(
    () => String(searchParams.get("search") || "").trim(),
    [searchParams]
  );
  const [pipelineView, setPipelineView] = useState(routePipelineView);
  const [filters, setFilters] = useState({
    search: "",
    status: "",
    date_from: "",
    date_to: "",
    vendedor: "",
    produto: "",
    banco: "",
    priority: "",
    sort_order: SORT_ORDER_OPTIONS.NEWEST_FIRST,
  });
  const openEditorsRef = useRef({});
  const pendingScrollRestoreRef = useRef(null);

  useEffect(() => {
    openEditorsRef.current = openEditors;
  }, [openEditors]);

  async function fetchPipeline() {
    try {
      setLoading(true);
      const data = await getPipeline();
      const list = Array.isArray(data) ? data : [];
      setNowMs(Date.now());

      setOperations(list);
      setDrafts((prev) => {
        const next = {};

        list.forEach((operation) => {
          const serverDraft = toDraft(operation);
          const editors = openEditorsRef.current[operation.id] || {};
          const keepLocalDraft = Boolean(
            editors.pendencia || editors.reprovacao || editors.formalizacao
          );

          next[operation.id] = keepLocalDraft
            ? { ...serverDraft, ...(prev[operation.id] || {}) }
            : serverDraft;
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

  useEffect(() => {
    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, 60000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setPipelineView(routePipelineView);
  }, [routePipelineView]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(PIPELINE_SCROLL_STORAGE_KEY);
      if (!raw) return;

      const saved = JSON.parse(raw);
      const currentPath = `${location.pathname}${location.search}`;
      if (saved?.path !== currentPath || !Number.isFinite(saved?.scrollY)) {
        return;
      }
      pendingScrollRestoreRef.current = {
        windowScrollY: Number(saved.scrollY) || 0,
        containerScrollTop: Number(saved.containerScrollTop) || 0,
      };
    } catch {
      pendingScrollRestoreRef.current = null;
      sessionStorage.removeItem(PIPELINE_SCROLL_STORAGE_KEY);
    }
  }, [location.pathname, location.search]);

  useEffect(() => {
    const targetScroll = pendingScrollRestoreRef.current;
    if (!targetScroll || loading) {
      return undefined;
    }

    const restoreScroll = () => {
      const container = getPageScrollContainer();
      if (container) {
        container.scrollTo({
          top: targetScroll.containerScrollTop,
          behavior: "auto",
        });
      }
      window.scrollTo({
        top: targetScroll.windowScrollY,
        behavior: "auto",
      });
    };

    const animationFrameId = requestAnimationFrame(() => {
      restoreScroll();
    });
    const shortRetryId = window.setTimeout(restoreScroll, 120);
    const finalRetryId = window.setTimeout(() => {
      restoreScroll();
      pendingScrollRestoreRef.current = null;
      sessionStorage.removeItem(PIPELINE_SCROLL_STORAGE_KEY);
    }, 320);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.clearTimeout(shortRetryId);
      window.clearTimeout(finalRetryId);
    };
  }, [loading, operations.length, location.pathname, location.search]);

  useEffect(() => {
    if (isVendor && routePipelineView === PIPELINE_VIEW_OPTIONS.READY) {
      navigate("/pipeline", { replace: true });
    }
  }, [isVendor, navigate, routePipelineView]);

  useEffect(() => {
    setFilters((prev) => {
      if (prev.search === routeSearchTerm) return prev;
      return { ...prev, search: routeSearchTerm };
    });
  }, [routeSearchTerm]);

  function handleDraftChange(operationId, field, value) {
    setDrafts((prev) => ({
      ...prev,
      [operationId]: {
        ...prev[operationId],
        [field]: value,
      },
    }));
  }

  async function loadOperationHistory(operationId, options = {}) {
    const { force = false } = options;

    if (!force && historyByOperation[operationId]) {
      return;
    }

    try {
      setLoadingHistoryOperationId(operationId);
      const data = await getOperationStatusHistory(operationId);
      setHistoryByOperation((prev) => ({
        ...prev,
        [operationId]: Array.isArray(data) ? data : [],
      }));
    } catch (error) {
      console.error("Erro ao carregar historico da operacao:", error);
      setHistoryByOperation((prev) => ({
        ...prev,
        [operationId]: [],
      }));
    } finally {
      setLoadingHistoryOperationId(null);
    }
  }

  function toggleHistory(operationId) {
    const isCurrentlyOpen = Boolean(openHistory[operationId]);

    if (!isCurrentlyOpen) {
      loadOperationHistory(operationId);
    }

    setOpenHistory((prev) => ({
      ...prev,
      [operationId]: !prev[operationId],
    }));
  }

  function toggleEditor(operationId, editorKey) {
    setOpenEditors((prev) => ({
      ...prev,
      [operationId]: {
        ...prev[operationId],
        pendencia: false,
        reprovacao: false,
        [editorKey]: !prev[operationId]?.[editorKey],
      },
    }));
  }

  function openEditor(operationId, editorKey) {
    setOpenEditors((prev) => ({
      ...prev,
      [operationId]: {
        ...prev[operationId],
        pendencia: false,
        reprovacao: false,
        [editorKey]: true,
      },
    }));
  }

  function toggleFormalizacaoEditor(operationId) {
    setOpenEditors((prev) => ({
      ...prev,
      [operationId]: {
        ...prev[operationId],
        formalizacao: !prev[operationId]?.formalizacao,
      },
    }));
  }

  function isFormalizacaoEditorOpen(operationId) {
    return Boolean(openEditors[operationId]?.formalizacao);
  }

  function isEditorOpen(operationId, editorKey) {
    return Boolean(openEditors[operationId]?.[editorKey]);
  }

  function toggleAndamentoMenu(operationId) {
    setOpenAndamentoMenu((prev) => ({
      ...prev,
      [operationId]: !prev[operationId],
    }));
  }

  async function updateFlow(operation, nextStatus, options = {}) {
    const { payloadOverrides = {}, clearPendencia = false } = options;
    const draft = drafts[operation.id] || {};
    const payload = {
      banco_digitacao: String(draft.banco_digitacao || "").trim(),
      pendencia_tipo: String(draft.pendencia_tipo || "").trim(),
      pendencia_motivo: String(draft.pendencia_motivo || "").trim(),
      link_formalizacao: String(draft.link_formalizacao || "").trim(),
      motivo_reprovacao: String(draft.motivo_reprovacao || "").trim(),
      promotora: String(draft.promotora || "").trim().toUpperCase(),
      status: nextStatus,
      ...payloadOverrides,
    };
    const numeroProposta = String(draft.numero_proposta || "").trim();
    const valorLiberadoInput = String(draft.valor_liberado || "").trim();
    const trocoInput = String(draft.troco || "").trim();
    const parcelaLiberadaInput = String(draft.parcela_liberada || "").trim();

    if (numeroProposta) payload.numero_proposta = numeroProposta;
    if (valorLiberadoInput) payload.valor_liberado = valorLiberadoInput;
    payload.troco = trocoInput;
    if (parcelaLiberadaInput) payload.parcela_liberada = parcelaLiberadaInput;

    if (clearPendencia) {
      payload.pendencia_tipo = "";
      payload.pendencia_motivo = "";
    }

    if (nextStatus === "AGUARDANDO_FORMALIZACAO" && !payload.link_formalizacao) {
      alert("Informe o link de formalizacao para devolver ao vendedor.");
      return;
    }

    if (nextStatus === "AGUARDANDO_FORMALIZACAO" && !payload.numero_proposta) {
      alert("Informe o numero da proposta.");
      return;
    }

    if (nextStatus === "AGUARDANDO_FORMALIZACAO") {
      const useSaldoField = usesSaldoLabels(operation.produto);
      const primaryValueLabel = useSaldoField ? "saldo" : "valor liberado";
      const valorLiberado = parseFlexibleDecimalInput(payload.valor_liberado);
      const troco = String(payload.troco || "").trim()
        ? parseFlexibleDecimalInput(payload.troco)
        : null;
      const parcelaLiberada = parseFlexibleDecimalInput(payload.parcela_liberada);

      if (!Number.isFinite(valorLiberado) || valorLiberado <= 0) {
        alert(`Informe um ${primaryValueLabel} valido.`);
        return;
      }

      if (troco !== null && (!Number.isFinite(troco) || troco < 0)) {
        alert("Informe um troco valido.");
        return;
      }

      if (!Number.isFinite(parcelaLiberada) || parcelaLiberada <= 0) {
        alert("Informe uma parcela liberada valida.");
        return;
      }

      payload.valor_liberado = valorLiberado;
      payload.troco = troco;
      payload.parcela_liberada = parcelaLiberada;
    }

    if (nextStatus === "PENDENCIA" && !payload.pendencia_motivo) {
      openEditor(operation.id, "pendencia");
      alert("Informe o motivo da pendencia.");
      return;
    }

    if (nextStatus === "DEVOLVIDA_VENDEDOR" && !payload.pendencia_motivo) {
      openEditor(operation.id, "pendencia");
      alert("Informe o motivo para devolver ao vendedor.");
      return;
    }

    if (nextStatus === "REPROVADO" && !payload.motivo_reprovacao) {
      openEditor(operation.id, "reprovacao");
      alert("Informe o motivo da reprovacao.");
      return;
    }

    try {
      setSavingOperationId(operation.id);
      await updateOperation(operation.id, payload);
      if (openHistory[operation.id]) {
        await loadOperationHistory(operation.id, { force: true });
      }
      setOpenEditors((prev) => ({
        ...prev,
        [operation.id]: {
          pendencia: false,
          reprovacao: false,
          formalizacao: false,
        },
      }));
      await fetchPipeline();
      window.dispatchEvent(new Event("pipeline:changed"));
    } catch (error) {
      console.error("Erro ao atualizar operacao:", error);
      alert(error.message || "Nao foi possivel atualizar a operacao");
    } finally {
      setSavingOperationId(null);
    }
  }

  async function handleSaveFormalizacaoData(operation) {
    const draft = drafts[operation.id] || {};
    const payload = {
      banco_digitacao: String(draft.banco_digitacao || "").trim(),
      promotora: String(draft.promotora || "").trim().toUpperCase(),
      troco: String(draft.troco || "").trim(),
    };

    const numeroProposta = String(draft.numero_proposta || "").trim();
    const linkFormalizacao = String(draft.link_formalizacao || "").trim();
    const valorInput = String(draft.valor_liberado || "").trim();
    const parcelaInput = String(draft.parcela_liberada || "").trim();
    const useSaldoField = usesSaldoLabels(operation.produto);
    const primaryValueLabel = useSaldoField ? "saldo" : "valor liberado";

    if (numeroProposta) {
      payload.numero_proposta = numeroProposta;
    }

    if (linkFormalizacao) {
      payload.link_formalizacao = linkFormalizacao;
    }

    if (valorInput) {
      const parsedValue = parseFlexibleDecimalInput(valorInput);
      if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
        alert(`Informe um ${primaryValueLabel} valido.`);
        return;
      }
      payload.valor_liberado = parsedValue;
    }

    if (parcelaInput) {
      const parsedInstallment = parseFlexibleDecimalInput(parcelaInput);
      if (!Number.isFinite(parsedInstallment) || parsedInstallment <= 0) {
        alert("Informe uma parcela valida.");
        return;
      }
      payload.parcela_liberada = parsedInstallment;
    }

    if (payload.troco) {
      const parsedTroco = parseFlexibleDecimalInput(payload.troco);
      if (!Number.isFinite(parsedTroco) || parsedTroco < 0) {
        alert("Informe um troco valido.");
        return;
      }
      payload.troco = parsedTroco;
    }

    const hasDataToSave = Boolean(
      numeroProposta ||
        linkFormalizacao ||
        valorInput ||
        parcelaInput ||
        payload.banco_digitacao ||
        payload.promotora ||
        payload.troco
    );

    if (!hasDataToSave) {
      alert("Preencha ao menos um dado para salvar.");
      return;
    }

    try {
      setSavingOperationId(operation.id);
      const response = await updateOperation(operation.id, payload);
      const updatedOperation = response?.operation;

      if (updatedOperation) {
        setDrafts((prev) => ({
          ...prev,
          [operation.id]: toDraft(updatedOperation),
        }));
      }

      if (openHistory[operation.id]) {
        await loadOperationHistory(operation.id, { force: true });
      }

      setOpenEditors((prev) => ({
        ...prev,
        [operation.id]: {
          ...prev[operation.id],
          formalizacao: false,
        },
      }));

      await fetchPipeline();
      window.dispatchEvent(new Event("pipeline:changed"));
    } catch (error) {
      console.error("Erro ao salvar dados da operacao:", error);
      alert(error.message || "Nao foi possivel salvar os dados da operacao");
    } finally {
      setSavingOperationId(null);
    }
  }

  async function handleAndamentoChange(operation, nextAndamento) {
    const normalizedAndamento = normalizeAndamentoStatus(nextAndamento);
    setOpenAndamentoMenu((prev) => ({
      ...prev,
      [operation.id]: false,
    }));

    try {
      setSavingOperationId(operation.id);
      const response = await updateOperation(operation.id, {
        status_andamento: normalizedAndamento,
      });
      const updatedOperation = response?.operation || null;

      setOperations((prev) =>
        prev.map((item) =>
          item.id === operation.id
            ? {
                ...item,
                ...(updatedOperation || {}),
                status_andamento:
                  updatedOperation?.status_andamento ?? normalizedAndamento ?? "",
              }
            : item
        )
      );

      setDrafts((prev) => ({
        ...prev,
        [operation.id]: {
          ...(prev[operation.id] || toDraft(operation)),
          status_andamento:
            updatedOperation?.status_andamento ?? normalizedAndamento ?? "",
        },
      }));

      await fetchPipeline();
      window.dispatchEvent(new Event("pipeline:changed"));
    } catch (error) {
      console.error("Erro ao atualizar andamento:", error);
      alert(error.message || "Nao foi possivel atualizar o andamento");
    } finally {
      setSavingOperationId(null);
    }
  }

  function handleReprovar(operation) {
    const draft = drafts[operation.id] || {};
    const selectedType = String(draft.reprovacao_tipo || "").trim();
    const selectedOption = REPROVACAO_REASON_OPTIONS.find(
      (option) => option.value === selectedType
    );
    const motivoBase = selectedOption?.label || "";
    const detalhe = String(draft.motivo_reprovacao || "").trim();

    if (!selectedType || !motivoBase) {
      openEditor(operation.id, "reprovacao");
      alert("Selecione o motivo da reprovacao.");
      return;
    }

    const motivoFinal = detalhe ? `${motivoBase}: ${detalhe}` : motivoBase;

    updateFlow(operation, "REPROVADO", {
      payloadOverrides: { motivo_reprovacao: motivoFinal },
    });
  }

  function handleDevolver(operation) {
    const draft = drafts[operation.id] || {};
    const motivo = String(draft.pendencia_motivo || "").trim();

    if (!motivo) {
      openEditor(operation.id, "pendencia");
      alert("Informe o motivo da pendencia para devolver ao vendedor.");
      return;
    }

    updateFlow(operation, "DEVOLVIDA_VENDEDOR");
  }

  async function handleReturnToPipeline(operation) {
    try {
      setSavingOperationId(operation.id);
      await sendOperationToPipeline(operation.id);
      if (openHistory[operation.id]) {
        await loadOperationHistory(operation.id, { force: true });
      }
      await fetchPipeline();
      window.dispatchEvent(new Event("pipeline:changed"));
    } catch (error) {
      console.error("Erro ao devolver operacao para a esteira:", error);
      alert(error.message || "Nao foi possivel devolver a operacao para a esteira");
    } finally {
      setSavingOperationId(null);
    }
  }

function handleAprovar(operation) {
  const cliente = String(operation.nome || "").trim() || "cliente";
  const confirmed = window.confirm(
      `Confirma marcar como paga a operacao #${operation.id} de ${cliente}?\n\nSe for um clique por engano, depois voce pode voltar o status pela planilha.`
  );

  if (!confirmed) return;
  updateFlow(operation, "APROVADO");
}

  function handleResolverPendencia(operation) {
    updateFlow(operation, "ANALISE_BANCO", { clearPendencia: true });
  }

  function handleLimparPendencia(operation) {
    handleDraftChange(operation.id, "pendencia_tipo", "");
    handleDraftChange(operation.id, "pendencia_motivo", "");

    if (operation.normalizedStatus === "ANALISE_BANCO") {
      updateFlow(operation, "ANALISE_BANCO", { clearPendencia: true });
    }
  }

  function getStatusBadge(operation, options = {}) {
    const { andamentoAtual = "", isSaving = false, canManageFlow = false } = options;
    const normalized = normalizeStatus(operation?.normalizedStatus || operation?.status);
    const isAnaliseBanco = normalized === "ANALISE_BANCO";

    let badgeToneClass = "yellow";
    if (normalized === "APROVADO") {
      badgeToneClass = "green";
    } else if (normalized === "REPROVADO") {
      badgeToneClass = "red";
    } else if (normalized === "PENDENCIA" || normalized === "DEVOLVIDA_VENDEDOR") {
      badgeToneClass = "blue";
    }

    if (!isAnaliseBanco) {
      const defaultLabel =
        normalized === "APROVADO"
          ? "PAGA"
          : normalized === "REPROVADO"
          ? "REPROVADA"
          : getStatusLabel(normalized);

      return <span className={`statusBadge ${badgeToneClass}`}>{defaultLabel}</span>;
    }

    const andamentoLabel = andamentoAtual
      ? getAndamentoLabel(andamentoAtual)
      : getStatusLabel(normalized);

    return (
      <div className="statusBadgeWrap">
        <button
          type="button"
          className={`statusBadge ${badgeToneClass} statusBadgeButton`}
          disabled={isSaving || !canManageFlow}
          onClick={(event) => {
            event.stopPropagation();
            toggleAndamentoMenu(operation.id);
          }}
        >
          {andamentoLabel}
        </button>

        {openAndamentoMenu[operation.id] && (
          <div
            className="statusAndamentoMenu"
            onClick={(event) => event.stopPropagation()}
          >
            {STATUS_ANDAMENTO_OPTIONS.map((option) => (
              <button
                key={option.value || "NONE"}
                type="button"
                className={`statusAndamentoOption${
                  option.value === andamentoAtual ? " active" : ""
                }`}
                disabled={isSaving || !canManageFlow}
                onClick={() => handleAndamentoChange(operation, option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const statusOptions = useMemo(() => {
    return Object.entries(STATUS_LABELS).filter(([status]) => {
      if (pipelineView === PIPELINE_VIEW_OPTIONS.READY) {
        return READY_PIPELINE_STATUSES.has(status);
      }
      return !READY_PIPELINE_STATUSES.has(status);
    });
  }, [pipelineView]);

  const operationsWithMeta = useMemo(() => {
    return operations.map((operation) => ({
      ...operation,
      normalizedStatus: normalizeStatus(operation.status),
      priority: getPriorityMeta(getPipelineReferenceAt(operation), nowMs),
    }));
  }, [operations, nowMs]);

  const scopedOperations = useMemo(() => {
    return operationsWithMeta.filter((operation) => {
      if (pipelineView === PIPELINE_VIEW_OPTIONS.READY) {
        return READY_PIPELINE_STATUSES.has(operation.normalizedStatus);
      }
      return !READY_PIPELINE_STATUSES.has(operation.normalizedStatus);
    });
  }, [operationsWithMeta, pipelineView]);

  const readyCount = useMemo(() => {
    return operationsWithMeta.filter(
      (operation) => READY_PIPELINE_STATUSES.has(operation.normalizedStatus)
    ).length;
  }, [operationsWithMeta]);

  const activeCount = useMemo(() => {
    return operationsWithMeta.filter(
      (operation) => !READY_PIPELINE_STATUSES.has(operation.normalizedStatus)
    ).length;
  }, [operationsWithMeta]);

  const vendorOptions = useMemo(() => {
    const names = Array.from(
      new Set(
        scopedOperations
          .map((operation) => String(operation.vendedor_nome || "").trim())
          .filter(Boolean)
      )
    );
    return names.sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [scopedOperations]);

  const productOptions = useMemo(() => {
    const names = Array.from(
      new Set(
        scopedOperations
          .map((operation) => String(operation.produto || "").trim())
          .filter(Boolean)
      )
    );
    return names.sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [scopedOperations]);

  const bankOptions = useMemo(() => {
    const names = Array.from(
      new Set(
        scopedOperations
          .map((operation) =>
            String(operation.banco_digitacao || operation.banco || "").trim()
          )
          .filter(Boolean)
      )
    );
    return names.sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [scopedOperations]);

  const rows = useMemo(() => {
    const fromDate = parseDateFilterBoundary(filters.date_from);
    const toDate = parseDateFilterBoundary(filters.date_to, true);

    return [...scopedOperations]
      .filter((operation) => {
        const query = String(filters.search || "").trim().toLowerCase();
        if (query) {
          const queryDigits = onlyDigits(query);
          const clientName = String(operation.nome || "").toLowerCase();
          const cpfText = String(operation.cpf || "");
          const cpfDigits = onlyDigits(cpfText);
          const benefitText = String(operation.numero_beneficio || "");
          const benefitDigits = onlyDigits(benefitText);
          const proposalText = String(operation.numero_proposta || "");
          const proposalDigits = onlyDigits(proposalText);
          const matchByText =
            clientName.includes(query) ||
            cpfText.toLowerCase().includes(query) ||
            benefitText.toLowerCase().includes(query) ||
            proposalText.toLowerCase().includes(query);
          const matchByDigits = queryDigits
            ? cpfDigits.includes(queryDigits) ||
              benefitDigits.includes(queryDigits) ||
              proposalDigits.includes(queryDigits)
            : false;

          if (!matchByText && !matchByDigits) {
            return false;
          }
        }

        if (filters.status && operation.normalizedStatus !== filters.status) {
          return false;
        }

        if (filters.vendedor) {
          const vendorName = String(operation.vendedor_nome || "").trim();
          if (vendorName !== filters.vendedor) {
            return false;
          }
        }

        if (filters.produto) {
          const productName = String(operation.produto || "").trim();
          if (productName !== filters.produto) {
            return false;
          }
        }

        if (filters.banco) {
          const bankName = String(
            operation.banco_digitacao || operation.banco || ""
          ).trim();
          if (bankName !== filters.banco) {
            return false;
          }
        }

        if (filters.priority && operation.priority.tone !== filters.priority) {
          return false;
        }

        if (fromDate || toDate) {
          const pipelineDate = new Date(getPipelineReferenceAt(operation));
          if (Number.isNaN(pipelineDate.getTime())) {
            return false;
          }

          if (fromDate && pipelineDate < fromDate) {
            return false;
          }

          if (toDate && pipelineDate > toDate) {
            return false;
          }
        }

        return true;
      })
      .sort((a, b) => {
        const sortDirection =
          filters.sort_order === SORT_ORDER_OPTIONS.OLDEST_FIRST ? 1 : -1;

        if (a.priority.createdMs !== b.priority.createdMs) {
          return (a.priority.createdMs - b.priority.createdMs) * sortDirection;
        }

        return (Number(a.id || 0) - Number(b.id || 0)) * sortDirection;
      });
  }, [scopedOperations, filters]);

  useEffect(() => {
    const allowedStatuses = new Set(statusOptions.map(([value]) => value));
    setFilters((prev) => {
      if (!prev.status || allowedStatuses.has(prev.status)) {
        return prev;
      }
      return {
        ...prev,
        status: "",
      };
    });
  }, [statusOptions]);

  function handlePipelineViewChange(nextView) {
    if (nextView === PIPELINE_VIEW_OPTIONS.READY) {
      navigate("/pipeline/prontas");
    } else {
      navigate("/pipeline");
    }

    setPipelineView(nextView);
    setFilters((prev) => ({
      ...prev,
      status: "",
    }));
  }

  function openOperationFicha(operation, event) {
    const interactive = event.target.closest(
      "button, input, select, textarea, a, label, .pipelineFlowCell"
    );

    if (interactive) return;
    const scrollContainer = getPageScrollContainer();
    sessionStorage.setItem(
      PIPELINE_SCROLL_STORAGE_KEY,
      JSON.stringify({
        path: `${location.pathname}${location.search}`,
        scrollY: window.scrollY,
        containerScrollTop: scrollContainer?.scrollTop || 0,
      })
    );
    navigate(`/operations/${operation.id}/ficha`);
  }

  function handleFilterChange(field, value) {
    const nextValue =
      field === "date_from" || field === "date_to"
        ? formatDateInputValue(value)
        : value;
    setFilters((prev) => ({
      ...prev,
      [field]: nextValue,
    }));
  }

  function openOperationComments(operation) {
    navigate(
      `/clients/${operation.cliente_id}/comentarios?operation_id=${operation.id}`
    );
  }

  return (
    <div className="pipelineContainer">
      <div className="pipelineHeader">
        <h2>Esteira de Operacoes</h2>
        <p>
          {pipelineView === PIPELINE_VIEW_OPTIONS.READY
            ? "Operacoes prontas para digitar ou em digitacao."
            : "Fluxo: digitacao, formalizacao, analise banco e pendencias."}
        </p>
      </div>

      <div className="pipelineViewTabs" role="tablist" aria-label="Visoes da esteira">
        <button
          type="button"
          role="tab"
          aria-selected={pipelineView === PIPELINE_VIEW_OPTIONS.ACTIVE}
          className={`pipelineViewTab${
            pipelineView === PIPELINE_VIEW_OPTIONS.ACTIVE ? " active" : ""
          }`}
          onClick={() => handlePipelineViewChange(PIPELINE_VIEW_OPTIONS.ACTIVE)}
        >
          Esteira principal ({activeCount})
        </button>
        {canAccessReadyPipeline && (
          <button
            type="button"
            role="tab"
            aria-selected={pipelineView === PIPELINE_VIEW_OPTIONS.READY}
            className={`pipelineViewTab${
              pipelineView === PIPELINE_VIEW_OPTIONS.READY ? " active" : ""
            }`}
            onClick={() => handlePipelineViewChange(PIPELINE_VIEW_OPTIONS.READY)}
          >
            Prontas para digitar ({readyCount})
          </button>
        )}
      </div>

      <div className="pipelineFilters">
        <label className="pipelineFilterField searchWide">
          <span>Busca</span>
          <input
            type="text"
            value={filters.search}
            onChange={(event) => handleFilterChange("search", event.target.value)}
            placeholder="Nome, CPF, numero de beneficio ou proposta"
          />
        </label>

        <label className="pipelineFilterField">
          <span>Status</span>
          <select
            value={filters.status}
            onChange={(event) => handleFilterChange("status", event.target.value)}
          >
            <option value="">Todos</option>
            {statusOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="pipelineFilterField">
          <span>Data inicial</span>
          <input
            type="text"
            value={filters.date_from}
            onChange={(event) => handleFilterChange("date_from", event.target.value)}
            inputMode="numeric"
            placeholder={DATE_INPUT_PLACEHOLDER}
          />
        </label>

        <label className="pipelineFilterField">
          <span>Data final</span>
          <input
            type="text"
            value={filters.date_to}
            onChange={(event) => handleFilterChange("date_to", event.target.value)}
            inputMode="numeric"
            placeholder={DATE_INPUT_PLACEHOLDER}
          />
        </label>

        <label className="pipelineFilterField">
          <span>Vendedor</span>
          <select
            value={filters.vendedor}
            onChange={(event) => handleFilterChange("vendedor", event.target.value)}
          >
            <option value="">Todos</option>
            {vendorOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <label className="pipelineFilterField">
          <span>Produto</span>
          <select
            value={filters.produto}
            onChange={(event) => handleFilterChange("produto", event.target.value)}
          >
            <option value="">Todos</option>
            {productOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <label className="pipelineFilterField">
          <span>Banco</span>
          <select
            value={filters.banco}
            onChange={(event) => handleFilterChange("banco", event.target.value)}
          >
            <option value="">Todos</option>
            {bankOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <label className="pipelineFilterField">
          <span>Prioridade</span>
          <select
            value={filters.priority}
            onChange={(event) => handleFilterChange("priority", event.target.value)}
          >
            <option value="">Todas</option>
            <option value="red">Urgente (&gt; 24h)</option>
            <option value="yellow">Atencao (&gt; 5h)</option>
            <option value="green">Normal</option>
          </select>
        </label>

        <label className="pipelineFilterField">
          <span>Ordem</span>
          <select
            value={filters.sort_order}
            onChange={(event) => handleFilterChange("sort_order", event.target.value)}
          >
            <option value={SORT_ORDER_OPTIONS.NEWEST_FIRST}>Mais novos primeiro</option>
            <option value={SORT_ORDER_OPTIONS.OLDEST_FIRST}>Mais antigos primeiro</option>
          </select>
        </label>
      </div>

      {loading && <p className="pipelineMessage">Carregando...</p>}

      {!loading && rows.length === 0 ? (
        <p className="pipelineMessage">
          {pipelineView === PIPELINE_VIEW_OPTIONS.READY
            ? "Nenhuma operacao pronta para digitar."
            : "Nenhuma operacao na esteira principal."}
        </p>
      ) : (
        <div className="tableWrapper">
          <table className="pipelineTable">
            <thead>
              <tr>
                <th>Prioridade</th>
                <th>Cliente</th>
                <th>Vendedor</th>
                <th>Produto</th>
                <th>Status</th>
                <th>Dados formalizacao</th>
                <th>Fluxo</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((operation) => {
                const draft = drafts[operation.id] || toDraft(operation);
                const isSaving = savingOperationId === operation.id;
                const pendenciaAberta = isEditorOpen(operation.id, "pendencia");
                const reprovacaoAberta = isEditorOpen(operation.id, "reprovacao");
                const formalizacaoAberta = isFormalizacaoEditorOpen(operation.id);
                const historyOpen = Boolean(openHistory[operation.id]);
                const historyItems = historyByOperation[operation.id] || [];
                const historyLoading = loadingHistoryOperationId === operation.id;
                const canManageFlow = !isVendor && !["APROVADO", "REPROVADO"].includes(
                  operation.normalizedStatus
                );
                const canResendToPipeline =
                  isVendor &&
                  (operation.normalizedStatus === "AGUARDANDO_FORMALIZACAO" ||
                    operation.normalizedStatus === "DEVOLVIDA_VENDEDOR");
                const andamentoAtual = normalizeAndamentoStatus(
                  Object.prototype.hasOwnProperty.call(draft, "status_andamento")
                    ? draft.status_andamento
                    : operation.status_andamento
                );
                const useSaldoField = usesSaldoLabels(operation.produto);
                const useProposalField = usesProposalLabels(operation.produto);
                const valorLabel = useSaldoField
                  ? "Saldo"
                  : useProposalField
                    ? "Valor da proposta"
                    : "Valor liberado";
                const parcelaLabel =
                  useSaldoField || useProposalField ? "Parcela" : "Parcela liberada";

                return (
                  <tr
                    key={operation.id}
                    className="clickableRow"
                    onClick={(event) => openOperationFicha(operation, event)}
                  >
                    <td>
                      <div className="pipelineIdCell">
                        <span className={`pipelinePriorityBadge ${operation.priority.tone}`}>
                          {operation.priority.label}
                        </span>
                      </div>
                    </td>
                    <td>
                      <strong>{operation.nome}</strong>
                      <div className="pipelineHint">{operation.cpf}</div>
                    </td>
                    <td>
                      <strong>{operation.vendedor_nome || "-"}</strong>
                    </td>
                    <td>
                      <strong>{operation.produto || "-"}</strong>
                      <div className="pipelineHint">{operation.banco_digitacao || "-"}</div>
                    </td>
                    <td className="pipelineStatusCell">
                      {getStatusBadge(operation, {
                        andamentoAtual,
                        isSaving,
                        canManageFlow,
                      })}
                      {operation.digitador_nome && (
                        <div className="pipelineDigitadorTag">
                          Digitador: {operation.digitador_nome}
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="formalizacaoBox">
                        <div className="formalizacaoSummaryGrid">
                          <div className="formalizacaoSummaryItem">
                            <span>Proposta</span>
                            <strong>{draft.numero_proposta || "-"}</strong>
                          </div>
                          <div className="formalizacaoSummaryItem">
                            <span>{valorLabel}</span>
                            <strong>{formatCurrency(draft.valor_liberado)}</strong>
                          </div>
                          {useSaldoField && (
                            <div className="formalizacaoSummaryItem">
                              <span>Troco</span>
                              <strong>{formatCurrency(draft.troco)}</strong>
                            </div>
                          )}
                          <div className="formalizacaoSummaryItem">
                            <span>{parcelaLabel}</span>
                            <strong>{formatCurrency(draft.parcela_liberada)}</strong>
                          </div>
                          <div className="formalizacaoSummaryItem">
                            <span>Promotora</span>
                            <strong>{draft.promotora || "-"}</strong>
                          </div>
                          <div className="formalizacaoSummaryItem link">
                            <span>Link</span>
                            <strong>
                              {draft.link_formalizacao ? (
                                <a
                                  href={draft.link_formalizacao}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Abrir
                                </a>
                              ) : (
                                "-"
                              )}
                            </strong>
                          </div>
                        </div>

                        {!isVendor && (
                          <button
                            type="button"
                            className={`toggleFormButton${formalizacaoAberta ? " active" : ""}`}
                            disabled={isSaving}
                            onClick={() => toggleFormalizacaoEditor(operation.id)}
                          >
                            {formalizacaoAberta ? "Fechar edicao" : "Editar dados"}
                          </button>
                        )}

                        {!isVendor && formalizacaoAberta && (
                          <>
                            <div className="proposalStackField">
                              {(() => {
                                const selectedBank = String(
                                  draft.banco_digitacao || operation.banco_digitacao || ""
                                ).trim();
                                const hasCurrentBank = BANK_OPTIONS.some(
                                  (option) => option.value === selectedBank
                                );

                                return (
                                  <select
                                    className="proposalInput"
                                    value={selectedBank}
                                    onChange={(event) =>
                                      handleDraftChange(
                                        operation.id,
                                        "banco_digitacao",
                                        event.target.value
                                      )
                                    }
                                  >
                                    {!hasCurrentBank && selectedBank && (
                                      <option value={selectedBank}>{selectedBank}</option>
                                    )}
                                    {BANK_OPTIONS.map((option) => (
                                      <option key={option.value} value={option.value}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                );
                              })()}
                              <input
                                type="text"
                                className="proposalInput"
                                placeholder="Numero da proposta"
                                value={draft.numero_proposta}
                                onChange={(event) =>
                                  handleDraftChange(
                                    operation.id,
                                    "numero_proposta",
                                    event.target.value
                                  )
                                }
                              />
                              <input
                                type="text"
                                inputMode="decimal"
                                className="proposalInput"
                                placeholder={valorLabel}
                                value={draft.valor_liberado}
                                onChange={(event) =>
                                  handleDraftChange(
                                    operation.id,
                                    "valor_liberado",
                                    event.target.value
                                  )
                                }
                              />
                              {useSaldoField && (
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  className="proposalInput"
                                  placeholder="Troco (opcional)"
                                  value={draft.troco}
                                  onChange={(event) =>
                                    handleDraftChange(
                                      operation.id,
                                      "troco",
                                      event.target.value
                                    )
                                  }
                                />
                              )}
                              <input
                                type="text"
                                inputMode="decimal"
                                className="proposalInput"
                                placeholder={parcelaLabel}
                                value={draft.parcela_liberada}
                                onChange={(event) =>
                                  handleDraftChange(
                                    operation.id,
                                    "parcela_liberada",
                                    event.target.value
                                  )
                                }
                              />
                              <select
                                className="proposalInput"
                                value={draft.promotora || ""}
                                onChange={(event) =>
                                  handleDraftChange(
                                    operation.id,
                                    "promotora",
                                    event.target.value
                                  )
                                }
                              >
                                {PROMOTORA_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                              <input
                                type="url"
                                className="proposalInput proposalLinkInput"
                                placeholder="https://..."
                                value={draft.link_formalizacao}
                                onChange={(event) =>
                                  handleDraftChange(
                                    operation.id,
                                    "link_formalizacao",
                                    event.target.value
                                  )
                                }
                              />
                            </div>
                            <div className="pipelinePanelActions">
                              <button
                                type="button"
                                className="saveBtn"
                                disabled={isSaving}
                                onClick={() => handleSaveFormalizacaoData(operation)}
                              >
                                Salvar dados
                              </button>
                              <button
                                type="button"
                                className="ghostPipelineBtn"
                                disabled={isSaving}
                                onClick={() => toggleFormalizacaoEditor(operation.id)}
                              >
                                Fechar
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="pipelineFlowCell">
                      <div className="pipelineActions">
                        {canManageFlow && (
                          <button
                            type="button"
                            className={`pendingBtn${pendenciaAberta ? " active" : ""}`}
                            disabled={isSaving}
                            onClick={() => toggleEditor(operation.id, "pendencia")}
                          >
                            Pendencia
                          </button>
                        )}

                        {canResendToPipeline && (
                          <button
                            type="button"
                            className="returnBtn"
                            disabled={isSaving}
                            onClick={() => handleReturnToPipeline(operation)}
                          >
                            Devolver para esteira
                          </button>
                        )}

                        {!isVendor && operation.normalizedStatus === "PRONTA_DIGITAR" && (
                          <>
                            <button
                              type="button"
                              className="saveBtn"
                              disabled={isSaving}
                              onClick={() => updateFlow(operation, "EM_DIGITACAO")}
                            >
                              Iniciar digitacao
                            </button>
                            <button
                              type="button"
                              className={`rejectBtn${reprovacaoAberta ? " active" : ""}`}
                              disabled={isSaving}
                              onClick={() => toggleEditor(operation.id, "reprovacao")}
                            >
                              Reprovar
                            </button>
                          </>
                        )}

                        {!isVendor && operation.normalizedStatus === "EM_DIGITACAO" && (
                          <>
                            <button
                              type="button"
                              className="returnBtn"
                              disabled={isSaving}
                              onClick={() => updateFlow(operation, "AGUARDANDO_FORMALIZACAO")}
                            >
                              Liberar formalizacao
                            </button>
                            <button
                              type="button"
                              className={`rejectBtn${reprovacaoAberta ? " active" : ""}`}
                              disabled={isSaving}
                              onClick={() => toggleEditor(operation.id, "reprovacao")}
                            >
                              Reprovar
                            </button>
                          </>
                        )}

                        {!isVendor && operation.normalizedStatus === "ANALISE_BANCO" && (
                          <>
                            <button
                              type="button"
                              className="returnBtn"
                              disabled={isSaving}
                              onClick={() => handleDevolver(operation)}
                            >
                              Devolver
                            </button>
                            <button
                              type="button"
                              className="approveBtn"
                              disabled={isSaving}
                              onClick={() => handleAprovar(operation)}
                            >
                              Marcar pago
                            </button>
                            <button
                              type="button"
                              className={`rejectBtn${reprovacaoAberta ? " active" : ""}`}
                              disabled={isSaving}
                              onClick={() => toggleEditor(operation.id, "reprovacao")}
                            >
                              Reprovar
                            </button>
                          </>
                        )}

		                        {!isVendor && operation.normalizedStatus === "AGUARDANDO_FORMALIZACAO" && (
	                          <>
	                            <button
	                              type="button"
	                              className="saveBtn"
	                              disabled={isSaving}
	                              onClick={() => updateFlow(operation, "ANALISE_BANCO")}
	                            >
	                              Formalizada
	                            </button>
	                            <button
	                              type="button"
	                              className={`rejectBtn${reprovacaoAberta ? " active" : ""}`}
	                              disabled={isSaving}
	                              onClick={() => toggleEditor(operation.id, "reprovacao")}
	                            >
	                              Reprovar
	                            </button>
	                          </>
	                        )}

                        {!isVendor && operation.normalizedStatus === "PENDENCIA" && (
                          <>
                            <button
                              type="button"
                              className="saveBtn"
                              disabled={isSaving}
                              onClick={() => handleResolverPendencia(operation)}
                            >
                              Resolver
                            </button>
                            <button
                              type="button"
                              className="returnBtn"
                              disabled={isSaving}
                              onClick={() => handleDevolver(operation)}
                            >
                              Devolver
                            </button>
                          </>
                        )}

                        <button
                          type="button"
                          className="ghostPipelineBtn"
                          disabled={isSaving}
                          onClick={() => openOperationComments(operation)}
                        >
                          Comentarios
                        </button>

                        <button
                          type="button"
                          className={`historyBtn${historyOpen ? " active" : ""}`}
                          disabled={historyLoading}
                          onClick={() => toggleHistory(operation.id)}
                        >
                          {historyLoading && !historyOpen ? "Carregando..." : "Historico"}
                        </button>
                      </div>

                      {operation.normalizedStatus === "AGUARDANDO_FORMALIZACAO" && (
                        <p className="pipelineInlineHint">Aguardando vendedor formalizar.</p>
                      )}

                      {operation.normalizedStatus === "DEVOLVIDA_VENDEDOR" && (
                        <p className="pipelineInlineHint">Aguardando vendedor reenviar.</p>
                      )}

                      {!isVendor && pendenciaAberta && (
                        <div className="pipelineActionPanel">
                          <h4>Pendencia</h4>
                          <div className="proposalStackField">
                            <select
                              className="proposalInput"
                              value={draft.pendencia_tipo}
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
                              placeholder="Digite o motivo da pendencia"
                              value={draft.pendencia_motivo}
                              onChange={(event) =>
                                handleDraftChange(
                                  operation.id,
                                  "pendencia_motivo",
                                  event.target.value
                                )
                              }
                            />
                          </div>

                          <div className="pipelinePanelActions">
                            <button
                              type="button"
                              className="pendingBtn"
                              disabled={isSaving}
                              onClick={() => updateFlow(operation, "PENDENCIA")}
                            >
                              Salvar pendencia
                            </button>
                            <button
                              type="button"
                              className="saveBtn"
                              disabled={isSaving}
                              onClick={() => handleResolverPendencia(operation)}
                            >
                              Resolver pendencia
                            </button>
                            <button
                              type="button"
                              className="returnBtn"
                              disabled={isSaving}
                              onClick={() => handleDevolver(operation)}
                            >
                              Devolver vendedor
                            </button>
                            {operation.normalizedStatus === "ANALISE_BANCO" && (
                              <button
                                type="button"
                                className="ghostPipelineBtn"
                                disabled={isSaving}
                                onClick={() => handleLimparPendencia(operation)}
                              >
                                Limpar pendencia
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      {!isVendor && reprovacaoAberta && (
                        <div className="pipelineActionPanel reprovacaoPanel">
                          <h4>Reprovacao</h4>
                          <div className="proposalStackField">
                            <select
                              className="proposalInput"
                              value={draft.reprovacao_tipo || ""}
                              onChange={(event) =>
                                handleDraftChange(
                                  operation.id,
                                  "reprovacao_tipo",
                                  event.target.value
                                )
                              }
                            >
                              {REPROVACAO_REASON_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            <textarea
                              className="proposalTextarea"
                              placeholder="Detalhe opcional"
                              value={draft.motivo_reprovacao}
                              onChange={(event) =>
                                handleDraftChange(
                                  operation.id,
                                  "motivo_reprovacao",
                                  event.target.value
                                )
                              }
                            />
                          </div>

                          <div className="pipelinePanelActions">
                            <button
                              type="button"
                              className="rejectBtn"
                              disabled={isSaving}
                              onClick={() => handleReprovar(operation)}
                            >
                              Confirmar reprovacao
                            </button>
                            <button
                              type="button"
                              className="ghostPipelineBtn"
                              disabled={isSaving}
                              onClick={() => toggleEditor(operation.id, "reprovacao")}
                            >
                              Fechar
                            </button>
                          </div>
                        </div>
                      )}

                      {historyOpen && (
                        <div className="pipelineHistoryPanel">
                          <div className="pipelineHistoryHeader">
                            <h4>Historico de status</h4>
                            <button
                              type="button"
                              className="ghostPipelineBtn"
                              disabled={historyLoading}
                              onClick={() =>
                                loadOperationHistory(operation.id, { force: true })
                              }
                            >
                              {historyLoading ? "Atualizando..." : "Atualizar"}
                            </button>
                          </div>

                          {historyLoading && historyItems.length === 0 ? (
                            <p className="pipelineHistoryEmpty">Carregando historico...</p>
                          ) : historyItems.length === 0 ? (
                            <p className="pipelineHistoryEmpty">Sem historico para esta operacao.</p>
                          ) : (
                            <ul className="pipelineHistoryList">
                              {historyItems.map((item, index) => (
                                <li
                                  key={`${operation.id}-${item.id || index}-${item.created_at || ""}`}
                                  className="pipelineHistoryItem"
                                >
                                  <div className="pipelineHistoryMain">
                                    <strong>{formatHistoryTransition(item)}</strong>
                                    <span>{formatHistoryActor(item)}</span>
                                    {item.note && <small>{item.note}</small>}
                                  </div>
                                  <time>{formatDateTime(item.created_at)}</time>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
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

