// Cloudflare Pages Functions 的共享工具：响应封装、参数校验与访问控制。
// 放在 _lib/ 下（下划线开头）不会被 Pages 识别为路由。

export const SECURITY_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff"
};

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { ...SECURITY_HEADERS, ...(init.headers || {}) }
  });
}

export function fail(status, code, message, details) {
  const body = { ok: false, error: code, message };
  if (details !== undefined) body.details = details;
  return json(body, { status });
}

export function ok(data, init = {}) {
  return json({ ok: true, ...data }, init);
}

export function methodNotAllowed(allowed) {
  return json(
    { ok: false, error: "method_not_allowed", message: `仅支持 ${allowed.join(" / ")}` },
    { status: 405, headers: { allow: allowed.join(", ") } }
  );
}

export async function readJsonBody(request, { limit = 16 * 1024 } = {}) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared && declared > limit) {
    return { error: fail(413, "payload_too_large", `请求体不得超过 ${limit} 字节`) };
  }
  const text = await request.text();
  if (text.length > limit) {
    return { error: fail(413, "payload_too_large", `请求体不得超过 ${limit} 字节`) };
  }
  if (!text.trim()) return { body: {} };
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return { error: fail(400, "invalid_body", "请求体必须是 JSON 对象") };
    }
    return { body };
  } catch {
    return { error: fail(400, "invalid_json", "请求体不是合法 JSON") };
  }
}

export function text(value, max = 200) {
  if (value === null || value === undefined) return "";
  const trimmed = String(value).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

export function int(value, fallback = 0, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? "").replace(/[^\d-]/g, ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/** 只允许站内相对路径或 http(s) 绝对地址，避免写入 javascript: 之类的值。 */
export function safeUrl(value, max = 600) {
  const raw = text(value, max);
  if (!raw) return "";
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  return "";
}

const SCHEME_CODE = /^[A-Za-z0-9\u4e00-\u9fa5·\-—_+. ]{4,160}$/;

export function schemeCode(value) {
  const raw = text(value, 160);
  if (!raw) return "";
  if (!SCHEME_CODE.test(raw)) return "";
  if (!raw.includes("-")) return "";
  return raw;
}

export function newId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

/** 管理端令牌校验：支持 Authorization: Bearer 或 X-Admin-Token，比较为常数时间。 */
export function adminGuard(request, env) {
  const expected = (env.ADMIN_TOKEN || "").trim();
  if (!expected) {
    return fail(503, "admin_token_missing", "服务端未配置 ADMIN_TOKEN，管理接口已关闭");
  }
  const header = request.headers.get("authorization") || "";
  const bearer = /^Bearer\s+(.+)$/i.exec(header.trim());
  const provided = (bearer ? bearer[1] : request.headers.get("x-admin-token") || "").trim();
  if (!provided || !timingSafeEqual(provided, expected)) {
    return fail(401, "unauthorized", "管理令牌无效");
  }
  return null;
}

export function timingSafeEqual(left, right) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let diff = a.length ^ b.length;
  const size = Math.max(a.length, b.length);
  for (let index = 0; index < size; index += 1) {
    diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return diff === 0;
}

export async function clientHash(request) {
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "local";
  const agent = request.headers.get("user-agent") || "";
  const day = new Date().toISOString().slice(0, 10);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${ip}|${agent}|${day}`));
  return [...new Uint8Array(digest)].slice(0, 12).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
