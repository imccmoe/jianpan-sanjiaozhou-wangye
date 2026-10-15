// 配装站 API 客户端：统一错误处理与查询串拼装。

const API_BASE = "/api";

async function request(path, { method = "GET", body, token, signal } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers["authorization"] = `Bearer ${token}`;
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok || !payload?.ok) {
    const error = new Error(payload?.message || `请求失败（HTTP ${response.status}）`);
    error.status = response.status;
    error.code = payload?.error || "http_error";
    error.details = payload?.details;
    throw error;
  }
  return payload;
}

function toQuery(filters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "" || value === 0) continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export const api = {
  meta: (options) => request("/meta", options),
  list: (filters, options) => request(`/schemes${toQuery(filters)}`, options),
  detail: (id, options) => request(`/schemes/${encodeURIComponent(id)}`, options),
  submit: (body, options) => request("/schemes/submit", { ...options, method: "POST", body }),
  feedback: (body, options) => request("/schemes/feedback", { ...options, method: "POST", body }),
  adminList: (filters, token, options) => request(`/admin/schemes${toQuery(filters)}`, { ...options, token }),
  review: (body, token, options) => request("/admin/review", { ...options, method: "POST", body, token })
};

export function errorText(error) {
  if (!error) return "未知错误";
  if (error.code === "db_unbound") return "服务端尚未绑定 D1 数据库（DB）";
  if (error.code === "admin_token_missing") return "服务端未配置 ADMIN_TOKEN，管理接口已关闭";
  return error.message || "请求失败";
}
