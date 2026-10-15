#!/usr/bin/env node
// 端到端冒烟测试：在进程内起一个 Pages 同构服务器
// （/api/* 交给 functions/ 下的 handler，其余从 public/ 提供静态文件），
// 然后对 http://127.0.0.1:<port> 发真实请求。
//
// 用法：node scripts/smoke-test.mjs [port]
//
// 说明：npm test 不包含本脚本。它需要监听本地端口，在受限沙箱环境里
// 可能被拒绝；wrangler pages dev 是更完整的替代方案。

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { MockD1, schemeRow } from "../tests/d1-mock.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const ADMIN_TOKEN = process.env.SMOKE_ADMIN_TOKEN || "smoke-admin-token";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wav": "audio/wav",
  ".hex": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png"
};

/* ---------------- 种子数据 ---------------- */

function seedSchemes() {
  const file = path.join(PUBLIC_DIR, "data", "schemes.json");
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, "utf8")).map((scheme, index) => schemeRow({
    id: scheme.id || `orzice-${index}`,
    game: scheme.game,
    mode: scheme.mode,
    weapon_name: scheme.weapon,
    object_name: scheme.objectName,
    weapon_type: scheme.type,
    image: scheme.image,
    value_score: Number(scheme.value) || 0,
    price: Number(scheme.price) || 0,
    usage_count: Number(scheme.users) || 0,
    like_count: Number(scheme.likes) || 0,
    author_name: scheme.author,
    gun_code: scheme.code,
    sensitivity_note: scheme.sensitivity || "",
    source_id: scheme.sourceId ? String(scheme.sourceId) : null,
    extra_json: JSON.stringify({ params: scheme.params || {} })
  }));
}

function createDatabase() {
  return new MockD1(
    { gun_schemes: seedSchemes(), scheme_feedback: [], audit_logs: [], submit_quota: [] },
    { primaryKeys: { gun_schemes: "id", scheme_feedback: "id", audit_logs: "id" } }
  );
}

/* ---------------- 路由 ---------------- */

// 顺序有意义：submit / feedback 必须排在 [id] 之前，否则会被当成方案 id。
const ROUTES = [
  { file: "functions/api/meta.js", pattern: /^\/api\/meta$/ },
  { file: "functions/api/schemes/index.js", pattern: /^\/api\/schemes$/ },
  { file: "functions/api/schemes/submit.js", pattern: /^\/api\/schemes\/submit$/ },
  { file: "functions/api/schemes/feedback.js", pattern: /^\/api\/schemes\/feedback$/ },
  { file: "functions/api/admin/schemes.js", pattern: /^\/api\/admin\/schemes$/ },
  { file: "functions/api/admin/review.js", pattern: /^\/api\/admin\/review$/ },
  { file: "functions/api/schemes/[id].js", pattern: /^\/api\/schemes\/([^/?]+)$/, params: ["id"] }
];

async function dispatchApi(request, env) {
  const url = new URL(request.url);
  const route = ROUTES.find((entry) => entry.pattern.test(url.pathname));
  if (!route) {
    return new Response(JSON.stringify({ ok: false, error: "no_route", message: "没有匹配的 API 路由" }), {
      status: 404,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }
  const matched = route.pattern.exec(url.pathname);
  const params = {};
  (route.params || []).forEach((name, index) => {
    params[name] = decodeURIComponent(matched[index + 1]);
  });

  const handlers = await import(pathToFileURL(path.join(ROOT, route.file)).href);
  const handler = request.method === "GET" ? handlers.onRequestGet
    : request.method === "POST" ? handlers.onRequestPost
      : handlers.onRequest;
  if (!handler) {
    return new Response(JSON.stringify({ ok: false, error: "no_handler", message: "该路由不支持此方法" }), {
      status: 405,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }
  return handler({ request, env, params, waitUntil() {}, next: async () => new Response("not found", { status: 404 }) });
}

function serveStatic(request, response) {
  // request.url 是路径形式（如 /hub/），必须补上 origin 才能构造 URL。
  const url = new URL(request.url, "http://127.0.0.1");
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith("/")) pathname += "index.html";
  const target = path.join(PUBLIC_DIR, pathname);
  const resolved = path.resolve(target);
  if (!resolved.startsWith(path.resolve(PUBLIC_DIR))) {
    response.writeHead(403).end("forbidden");
    return;
  }
  const file = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
    ? path.join(resolved, "index.html")
    : resolved;
  if (!fs.existsSync(file)) {
    // Pages 的 SPA 行为：找不到路径时回退到站点首页。
    const fallback = path.join(PUBLIC_DIR, "index.html");
    response.writeHead(404, { "content-type": MIME[".html"] }).end(fs.readFileSync(fallback));
    return;
  }
  response.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" })
    .end(fs.readFileSync(file));
}

function startServer(env) {
  const server = http.createServer(async (request, response) => {
    try {
      if (request.url.startsWith("/api/")) {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = chunks.length ? Buffer.concat(chunks) : undefined;
        const apiRequest = new Request(`http://127.0.0.1${request.url}`, {
          method: request.method,
          headers: request.headers,
          body: ["GET", "HEAD"].includes(request.method) ? undefined : body
        });
        const apiResponse = await dispatchApi(apiRequest, env);
        response.writeHead(apiResponse.status, Object.fromEntries(apiResponse.headers));
        response.end(Buffer.from(await apiResponse.arrayBuffer()));
        return;
      }
      serveStatic(request, response);
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json; charset=utf-8" })
        .end(JSON.stringify({ ok: false, error: "internal", message: error.message }));
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

/* ---------------- 断言 ---------------- */

let passed = 0;
const failures = [];

function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ✔ ${label}`);
    return true;
  }
  failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
  console.log(`  ✖ ${label}${detail ? ` — ${detail}` : ""}`);
  return false;
}

async function main() {
  const env = { DB: createDatabase(), ADMIN_TOKEN, ENVIRONMENT: "smoke" };
  const server = await startServer(env);
  const base = `http://127.0.0.1:${server.address().port}`;
  console.log(`冒烟服务器已启动：${base}`);

  const json = async (path, options) => {
    const response = await fetch(`${base}${path}`, options);
    const payload = await response.json().catch(() => null);
    return { status: response.status, payload, headers: response.headers };
  };
  const post = (path, body, headers = {}) => json(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });

  try {
    console.log("\n[静态资源]");
    for (const [pathname, needle] of [
      ["/", "ZFQ 站点导航"],
      ["/hub/", "ZFQ 配装方案站"],
      ["/hub/hub.css", "--violet"],
      ["/hub/app.js", "hashchange"],
      ["/keyboard.html", "SJZ 三键音乐键盘"],
      ["/app.js", "loadCatalog"],
      ["/data/music-catalog.json", "\"songs\""]
    ]) {
      const response = await fetch(`${base}${pathname}`);
      const body = await response.text();
      check(`${pathname} 可访问（HTTP ${response.status}）`, response.ok && body.includes(needle), `未包含 ${needle}`);
    }

    console.log("\n[元信息]");
    const meta = await json("/api/meta");
    check("GET /api/meta 返回 200", meta.status === 200, `实际 ${meta.status}`);
    check("方案总数大于 0", meta.payload?.total > 0, `total=${meta.payload?.total}`);
    check("包含筛选面", Array.isArray(meta.payload?.facets?.types) && meta.payload.facets.types.length > 0);
    const total = meta.payload?.total || 0;

    console.log("\n[列表与筛选]");
    const list = await json("/api/schemes?limit=5");
    check("GET /api/schemes 返回 200", list.status === 200, `实际 ${list.status}`);
    check("limit 生效", list.payload?.items?.length === 5, `实际 ${list.payload?.items?.length}`);
    check("total 与 meta 一致", list.payload?.total === total, `${list.payload?.total} vs ${total}`);
    check("列表项含分享码", Boolean(list.payload?.items?.[0]?.code));

    const filtered = await json("/api/schemes?game=valorant&limit=3");
    check("game=valorant 过滤生效", filtered.payload?.items?.every((item) => item.game === "valorant"));

    const searched = await json("/api/schemes?q=QCQ171&limit=5");
    check("关键词搜索有命中", searched.payload?.total > 0, `total=${searched.payload?.total}`);

    const sorted = await json("/api/schemes?sort=new&limit=1");
    check("sort=new 可用", sorted.status === 200 && sorted.payload?.sort === "new");

    console.log("\n[详情与反馈]");
    const firstId = list.payload.items[0].id;
    const detail = await json(`/api/schemes/${encodeURIComponent(firstId)}`);
    check("GET /api/schemes/:id 返回 200", detail.status === 200, `实际 ${detail.status}`);
    check("详情包含 params 与 feedback", Boolean(detail.payload?.scheme?.params) && Boolean(detail.payload?.scheme?.feedback));
    check("详情包含同类推荐", Array.isArray(detail.payload?.related));

    const missing = await json("/api/schemes/does-not-exist");
    check("不存在的方案返回 404", missing.status === 404, `实际 ${missing.status}`);

    const feedback = await post("/api/schemes/feedback", { schemeId: firstId, type: "good" });
    check("提交反馈返回 201", feedback.status === 201, `实际 ${feedback.status}`);
    const feedbackAgain = await post("/api/schemes/feedback", { schemeId: firstId, type: "good" });
    check("同类型反馈被去重（409）", feedbackAgain.status === 409, `实际 ${feedbackAgain.status}`);
    const afterFeedback = await json(`/api/schemes/${encodeURIComponent(firstId)}`);
    check("点赞数已累加", afterFeedback.payload?.scheme?.feedback?.good === 1, JSON.stringify(afterFeedback.payload?.scheme?.feedback));

    console.log("\n[投稿]");
    const submission = {
      game: "delta", mode: "operations", weapon: "冒烟测试方案", type: "步枪",
      code: "冒烟测试方案-烽火地带-SMOKE-0001", author: "冒烟", value: 111, price: 222,
      params: { control: 50, stability: 40, recoil: "60" }
    };
    const created = await post("/api/schemes/submit", submission);
    check("投稿返回 201", created.status === 201, `实际 ${created.status} ${JSON.stringify(created.payload)}`);
    check("投稿进入 pending", created.payload?.status === "pending");
    const duplicate = await post("/api/schemes/submit", submission);
    check("重复分享码被拒绝（409）", duplicate.status === 409, `实际 ${duplicate.status}`);
    const invalid = await post("/api/schemes/submit", { weapon: "x", code: "javascript:alert(1)", game: "csgo" });
    check("非法投稿返回 400", invalid.status === 400, `实际 ${invalid.status}`);
    const pendingDetail = await json(`/api/schemes/${created.payload.id}`);
    check("待审方案不出现在公开详情", pendingDetail.status === 404, `实际 ${pendingDetail.status}`);

    console.log("\n[管理台]");
    const unauthorized = await json("/api/admin/schemes?status=pending");
    check("无令牌访问管理接口返回 401", unauthorized.status === 401, `实际 ${unauthorized.status}`);
    const authorized = await json("/api/admin/schemes?status=pending", {
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
    });
    check("带令牌可读取待审队列", authorized.status === 200, `实际 ${authorized.status}`);
    check("待审队列包含刚投稿的方案", authorized.payload?.items?.some((item) => item.id === created.payload.id));
    check("stats 正确统计待审数", authorized.payload?.stats?.pending >= 1, JSON.stringify(authorized.payload?.stats));

    const approved = await post("/api/admin/review", { schemeId: created.payload.id, action: "approve" },
      { authorization: `Bearer ${ADMIN_TOKEN}` });
    check("审核通过返回 200", approved.status === 200, `实际 ${approved.status}`);
    check("状态变为 active", approved.payload?.status === "active");
    const approvedDetail = await json(`/api/schemes/${created.payload.id}`);
    check("通过后可公开访问", approvedDetail.status === 200, `实际 ${approvedDetail.status}`);

    const hidden = await post("/api/admin/review", { schemeId: created.payload.id, action: "hide" },
      { authorization: `Bearer ${ADMIN_TOKEN}` });
    check("下架返回 200", hidden.status === 200, `实际 ${hidden.status}`);
    const hiddenDetail = await json(`/api/schemes/${created.payload.id}`);
    check("下架后不可公开访问", hiddenDetail.status === 404, `实际 ${hiddenDetail.status}`);

    console.log("\n[边界]");
    const badMethod = await json("/api/schemes", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    check("错误方法返回 405", badMethod.status === 405, `实际 ${badMethod.status}`);
    const badJson = await fetch(`${base}/api/schemes/feedback`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{ not json"
    });
    check("非法 JSON 返回 400", badJson.status === 400, `实际 ${badJson.status}`);
    const clamped = await json("/api/schemes?limit=9999");
    check("limit 被限制在 60", clamped.payload?.limit === 60, `实际 ${clamped.payload?.limit}`);
  } finally {
    server.close();
  }

  console.log(`\n通过 ${passed} 项，失败 ${failures.length} 项`);
  if (failures.length) {
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exitCode = 1;
  }
}

await main();
