// GET /api/meta —— 站点元信息与筛选面（类型分布、游戏、模式、热门作者）。
import { d1, facets, GAMES, MODES, PUBLIC_STATUSES, SORTS } from "./_lib/db.js";
import { fail, methodNotAllowed, ok } from "./_lib/http.js";

export async function onRequestGet({ env }) {
  try {
    const db = d1(env);
    const facetData = await facets(db);
    const authors = await db
      .prepare(
        "SELECT author_name AS name, COUNT(*) AS count FROM gun_schemes" +
        " WHERE status = 'active' AND author_name <> '' GROUP BY author_name" +
        " ORDER BY count DESC LIMIT 12"
      )
      .all();
    return ok({
      total: facetData.types.reduce((sum, item) => sum + item.count, 0),
      games: Object.entries(GAMES).map(([id, label]) => ({ id, label })),
      modes: Object.entries(MODES).map(([id, label]) => ({ id, label })),
      statuses: PUBLIC_STATUSES,
      sorts: Object.keys(SORTS),
      facets: facetData,
      topAuthors: (authors.results || []).map((row) => ({
        name: row.name,
        count: Number(row.count) || 0
      }))
    });
  } catch (error) {
    return fail(error.status || 500, error.code || "meta_failed", error.message);
  }
}

export function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  return methodNotAllowed(["GET"]);
}
