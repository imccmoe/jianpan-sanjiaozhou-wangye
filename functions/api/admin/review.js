// POST /api/admin/review —— 审核方案：approve / reject / hide / restore。
// 每次状态变更都写入 audit_logs，便于追溯。
import { d1, STATUSES } from "../_lib/db.js";
import { adminGuard, fail, methodNotAllowed, newId, ok, readJsonBody, text } from "../_lib/http.js";

const ACTIONS = {
  approve: { status: "active", from: ["pending", "rejected", "hidden"] },
  reject: { status: "rejected", from: ["pending", "active", "hidden"] },
  hide: { status: "hidden", from: ["active", "pending"] },
  restore: { status: "active", from: ["hidden", "rejected"] }
};

export async function onRequestPost({ request, env }) {
  const denied = adminGuard(request, env);
  if (denied) return denied;
  try {
    const db = d1(env);
    const { body, error } = await readJsonBody(request, { limit: 4 * 1024 });
    if (error) return error;

    const schemeId = text(body.schemeId || body.id, 80);
    const action = text(body.action, 20);
    const note = text(body.note, 200);
    const adminId = text(body.adminId, 60) || "admin";
    if (!schemeId) return fail(400, "missing_scheme", "缺少 schemeId");
    const rule = ACTIONS[action];
    if (!rule) return fail(400, "invalid_action", `action 必须是 ${Object.keys(ACTIONS).join(" / ")}`);

    const scheme = await db
      .prepare("SELECT id, status FROM gun_schemes WHERE id = ?")
      .bind(schemeId)
      .first();
    if (!scheme) return fail(404, "not_found", "方案不存在");
    if (!rule.from.includes(scheme.status)) {
      return fail(
        409,
        "invalid_transition",
        `方案当前状态为 ${scheme.status}，不能执行 ${action}`,
        { from: scheme.status, allowedFrom: rule.from }
      );
    }
    if (!STATUSES.includes(rule.status)) return fail(500, "bad_rule", "内部状态规则错误");

    await db.batch([
      db
        .prepare("UPDATE gun_schemes SET status = ?, updated_at = ? WHERE id = ?")
        .bind(rule.status, new Date().toISOString(), schemeId),
      db
        .prepare("INSERT INTO audit_logs (id, scheme_id, admin_id, action, note) VALUES (?, ?, ?, ?, ?)")
        .bind(newId("log"), schemeId, adminId, action, note)
    ]);

    return ok({ id: schemeId, from: scheme.status, status: rule.status, action });
  } catch (error) {
    return fail(error.status || 500, error.code || "review_failed", error.message);
  }
}

export function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return methodNotAllowed(["POST"]);
}
