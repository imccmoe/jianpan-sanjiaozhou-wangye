// POST /api/schemes/feedback —— 方案反馈：好用 / 不准 / 效果弱 / 已失效。
import { d1, FEEDBACK_TYPES } from "../_lib/db.js";
import { clientHash, fail, methodNotAllowed, newId, ok, readJsonBody, text } from "../_lib/http.js";

const LIKE_TYPES = new Set(["good"]);

export async function onRequestPost({ request, env }) {
  try {
    const db = d1(env);
    const { body, error } = await readJsonBody(request, { limit: 4 * 1024 });
    if (error) return error;

    const schemeId = text(body.schemeId || body.id, 80);
    const type = text(body.type, 20);
    const note = text(body.note, 200);
    if (!schemeId) return fail(400, "missing_scheme", "缺少 schemeId");
    if (!FEEDBACK_TYPES.includes(type)) {
      return fail(400, "invalid_type", `type 必须是 ${FEEDBACK_TYPES.join(" / ")}`);
    }

    const scheme = await db
      .prepare("SELECT id, status FROM gun_schemes WHERE id = ?")
      .bind(schemeId)
      .first();
    if (!scheme || scheme.status !== "active") {
      return fail(404, "not_found", "方案不存在或不可反馈");
    }

    const hash = await clientHash(request);
    // 用显式 ISO 时间戳做窗口比较：CURRENT_TIMESTAMP 的格式是
    // "YYYY-MM-DD HH:MM:SS"，与 ISO-8601 做字符串比较不可靠。
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const duplicate = await db
      .prepare(
        "SELECT id FROM scheme_feedback WHERE scheme_id = ? AND client_hash = ? AND feedback_type = ?" +
        " AND created_at > ? LIMIT 1"
      )
      .bind(schemeId, hash, type, since)
      .first();
    if (duplicate) return fail(409, "duplicate_feedback", "今天已经提交过同样的反馈");

    const statements = [
      db
        .prepare(
          "INSERT INTO scheme_feedback (id, scheme_id, user_id, feedback_type, note, client_hash, created_at)" +
          " VALUES (?, ?, NULL, ?, ?, ?, ?)"
        )
        .bind(newId("fb"), schemeId, type, note, hash, new Date().toISOString()),
      db
        .prepare(
          LIKE_TYPES.has(type)
            ? "UPDATE gun_schemes SET like_count = like_count + 1 WHERE id = ?"
            : "UPDATE gun_schemes SET updated_at = ? WHERE id = ?"
        )
        .bind(...(LIKE_TYPES.has(type) ? [schemeId] : [new Date().toISOString(), schemeId]))
    ];

    await db.batch(statements);
    return ok({ schemeId, type, message: "反馈已记录" }, { status: 201 });
  } catch (error) {
    return fail(error.status || 500, error.code || "feedback_failed", error.message);
  }
}

export function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return methodNotAllowed(["POST"]);
}
