// GET /api/admin/schemes —— 待审 / 已发布 / 已拒绝队列（需要 ADMIN_TOKEN）。
import { d1, listQuery, querySchemes } from "../_lib/db.js";
import { adminGuard, fail, methodNotAllowed, ok, text } from "../_lib/http.js";

export async function onRequestGet({ request, env }) {
  const denied = adminGuard(request, env);
  if (denied) return denied;
  try {
    const db = d1(env);
    const url = new URL(request.url);
    const options = listQuery(url, { includeStatus: true });
    const [{ items, total }, stats] = await Promise.all([
      querySchemes(db, options),
      db
        .prepare("SELECT status, COUNT(*) AS count FROM gun_schemes GROUP BY status")
        .all()
    ]);
    return ok({
      items,
      total,
      limit: options.limit,
      offset: options.offset,
      sort: options.sort,
      hasMore: options.offset + items.length < total,
      statusFilter: text(url.searchParams.get("status"), 20) || "all",
      stats: Object.fromEntries((stats.results || []).map((row) => [row.status, Number(row.count) || 0]))
    });
  } catch (error) {
    return fail(error.status || 500, error.code || "admin_list_failed", error.message);
  }
}

export function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  return methodNotAllowed(["GET"]);
}
