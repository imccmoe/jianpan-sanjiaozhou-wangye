// GET /api/schemes —— 方案列表：筛选、排序、分页。
import { d1, facets, listQuery, querySchemes } from "../_lib/db.js";
import { fail, methodNotAllowed, ok } from "../_lib/http.js";

export async function onRequestGet({ request, env }) {
  try {
    const db = d1(env);
    const url = new URL(request.url);
    const options = listQuery(url);
    const [{ items, total }, facetData] = await Promise.all([
      querySchemes(db, options),
      facets(db)
    ]);
    return ok({
      items,
      total,
      limit: options.limit,
      offset: options.offset,
      sort: options.sort,
      hasMore: options.offset + items.length < total,
      facets: facetData
    });
  } catch (error) {
    return fail(error.status || 500, error.code || "query_failed", error.message);
  }
}

export function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet(context);
  return methodNotAllowed(["GET"]);
}
