export const DATE_INPUT_PLACEHOLDER = "dd/mm/aaaa";

export function formatDateInputValue(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  const isoMatch = text.match(/^(\d{4})[\/.-](\d{2})[\/.-](\d{2})$/);
  if (isoMatch) {
    return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  }

  const brMatch = text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (brMatch) {
    const day = brMatch[1].padStart(2, "0");
    const month = brMatch[2].padStart(2, "0");
    return `${day}/${month}/${brMatch[3]}`;
  }

  const digits = text.replace(/\D/g, "").slice(0, 8);
  if (!digits) return "";
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

export function formatDateDisplayValue(value) {
  const text = String(value || "").trim();
  if (!text) return "-";

  const direct = formatDateInputValue(text);
  if (direct && /^\d{2}\/\d{2}\/\d{4}$/.test(direct)) {
    return direct;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return text;

  return date.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

export function formatDateTimeDisplayValue(value, fallback = "-") {
  const text = String(value || "").trim();
  if (!text) return fallback;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return text;

  return date.toLocaleString("pt-BR");
}

export function normalizeDateInputValue(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  const isoMatch = text.match(/^(\d{4})[\/.-](\d{2})[\/.-](\d{2})$/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  const brMatch = text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (brMatch) {
    const day = brMatch[1].padStart(2, "0");
    const month = brMatch[2].padStart(2, "0");
    return `${brMatch[3]}-${month}-${day}`;
  }

  return text;
}

export function parseDateFilterBoundary(value, endOfDay = false) {
  const normalized = normalizeDateInputValue(value);
  const isoMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!isoMatch) return null;

  const suffix = endOfDay ? "T23:59:59.999" : "T00:00:00";
  const date = new Date(`${normalized}${suffix}`);
  return Number.isNaN(date.getTime()) ? null : date;
}
