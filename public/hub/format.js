// 纯展示工具：格式化与数值文案。

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const compact = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 });
const plain = new Intl.NumberFormat("zh-CN");

export function count(value) {
  const number = Number(value) || 0;
  return number >= 10_000 ? compact.format(number) : plain.format(number);
}

export function money(value) {
  const number = Number(value) || 0;
  if (!number) return "—";
  return `${count(number)} 币`;
}

export function dateTime(value) {
  if (!value) return "—";
  const normalized = String(value).includes("T") ? String(value) : `${String(value).replace(" ", "T")}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export const STATUS_LABELS = {
  active: "已发布",
  pending: "待审核",
  rejected: "已拒绝",
  hidden: "已下架"
};

export function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

const PARAM_LABELS = [
  ["recoil", "后座"],
  ["control", "操控"],
  ["stability", "稳定"],
  ["hip", "腰射"],
  ["range", "射程"],
  ["ads", "开镜"],
  ["interval", "射击间隔"],
  ["scope", "倍镜"]
];

// 有 0~100 量纲、适合画进度条的字段。
const NUMERIC_PARAMS = new Set(["control", "stability", "hip", "range", "ads", "recoil"]);

export function paramEntries(params) {
  if (!params || typeof params !== "object") return [];
  return PARAM_LABELS
    .filter(([key]) => params[key] !== undefined && params[key] !== null && params[key] !== "")
    .map(([key, label]) => ({ key, label, value: params[key], numeric: NUMERIC_PARAMS.has(key) }));
}

export function barWidth(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(2, Math.min(100, number));
}

/** 站内分享链接：带筛选条件的可复制地址。 */
export function shareUrl(filters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters || {})) {
    if (value === undefined || value === null || value === "" || value === 0) continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return `${location.origin}/hub/${query ? `?${query}` : ""}`;
}

export function debounce(fn, wait = 260) {
  let timer = null;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  };
}

export function showToast(message, type = "info") {
  document.querySelector(".toast")?.remove();
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.textContent = message;
  document.body.appendChild(node);
  window.setTimeout(() => node.remove(), 3400);
}

export async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = value;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}
