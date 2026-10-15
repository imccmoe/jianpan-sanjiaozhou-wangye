// GET /api/schemes/:id —— 方案详情，附带反馈统计与同类推荐。
import { d1, getScheme, shapeScheme } from "../_lib/db.js";
import { fail, methodNotAllowed, ok, text } from "../_lib/http.js";

export async function onRequestGet({ request, env, params }) {
  try {
    const db = d1(env);
    const id = text(Array.isArray(params.id) ? params.id[0] : params.id, 80);
    if (!id) return fail(400, "missing_id", "缺少方案 id");

    const scheme = await getScheme(db, id);
    if (!scheme || scheme.status !== "active") {
      return fail(404, "not_found", "方案不存在或尚未通过审核");
    }

    const [counts, related] = await db.batch([
      db.prepare(
        "SELECT feedback_type AS type, COUNT(*) AS count FROM scheme_feedback" +
        " WHERE scheme_id = ? GROUP BY feedback_type"
      ).bind(id),
      db.prepare(
        "SELECT * FROM gun_schemes WHERE status = 'active' AND id <> ? AND weapon_type = ?" +
        " ORDER BY usage_count DESC LIMIT 6"
      ).bind(id, scheme.type)
    ]);

    // realtime 统计来自 scheme_feedback 表，应当覆盖导入数据里携带的静态快照。
    const feedback = Object.fromEntries((counts.results || []).map((row) => [row.type, Number(row.count) || 0]));
    for (const [type, value] of Object.entries(feedback)) delete scheme.feedback?.[type];
    return ok({
      scheme: { ...scheme, feedback: { ...(scheme.feedback || {}), ...feedback } },
      related: (related.results || []).map((row) => shapeScheme(row))
    });
  } catch (error) {
    return fail(error.status || 500, error.code || "query_failed", error.message);
  }
}

export function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  return methodNotAllowed(["GET"]);
}
