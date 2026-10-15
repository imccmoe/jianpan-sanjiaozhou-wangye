// POST /api/schemes/submit —— 匿名投稿，进入 pending 待审状态。
import { d1, normalizeSubmission } from "../_lib/db.js";
import { clientHash, fail, methodNotAllowed, newId, ok, readJsonBody, text } from "../_lib/http.js";

const WINDOW_MINUTES = 60;
const MAX_PER_WINDOW = 8;

export async function onRequestPost({ request, env }) {
  try {
    const db = d1(env);
    const { body, error } = await readJsonBody(request);
    if (error) return error;

    const { errors, value } = normalizeSubmission(body);
    if (errors.length) return fail(400, "invalid_submission", errors.join("；"), errors);

    const hash = await clientHash(request);
    const windowStart = new Date(Date.now() - (Date.now() % (WINDOW_MINUTES * 60_000))).toISOString();

    const existing = await db
      .prepare("SELECT submit_count FROM submit_quota WHERE client_hash = ? AND window_start = ?")
      .bind(hash, windowStart)
      .first();
    if (Number(existing?.submit_count) >= MAX_PER_WINDOW) {
      return fail(429, "rate_limited", `每个客户端每小时最多投稿 ${MAX_PER_WINDOW} 条，请稍后再试`);
    }

    const duplicate = await db
      .prepare("SELECT id FROM gun_schemes WHERE gun_code = ?")
      .bind(value.code)
      .first();
    if (duplicate) {
      return fail(409, "duplicate_code", "该方案分享码已存在，可直接搜索查看");
    }

    const id = newId("hub");
    const extra = JSON.stringify({ params: value.params, feedback: {} });
    const statements = [
      db
        .prepare(
          "INSERT INTO gun_schemes (id, game, mode, weapon_name, object_name, weapon_type, ammo, map," +
          " image, value_score, price, usage_count, like_count, author_name, gun_code, adapter_config," +
          " sensitivity_note, status, source, extra_json)" +
          " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, '', ?, 'pending', 'user', ?)"
        )
        .bind(
          id, value.game, value.mode, value.weapon, value.objectName, value.type, value.ammo, value.map,
          value.image, value.valueScore, value.price, value.author, value.code, value.sensitivity, extra
        ),
      db
        .prepare(
          "INSERT INTO submit_quota (client_hash, window_start, submit_count) VALUES (?, ?, 1)" +
          " ON CONFLICT(client_hash, window_start) DO UPDATE SET submit_count = submit_count + 1"
        )
        .bind(hash, windowStart),
      db
        .prepare("INSERT INTO audit_logs (id, scheme_id, admin_id, action, note) VALUES (?, ?, NULL, 'submit', ?)")
        .bind(newId("log"), id, text(value.author, 40))
    ];

    await db.batch(statements);
    return ok({ id, status: "pending", message: "投稿已提交，审核通过后会出现在列表中" }, { status: 201 });
  } catch (error) {
    return fail(error.status || 500, error.code || "submit_failed", error.message);
  }
}

export function onRequest(context) {
  if (context.request.method === "POST") return onRequestPost(context);
  return methodNotAllowed(["POST"]);
}
