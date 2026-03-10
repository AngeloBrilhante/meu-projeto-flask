export const DATE_INPUT_PLACEHOLDER = "dd/mm/aaaa ou aaaa-mm-dd";

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
