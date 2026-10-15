import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { MockD1, schemeRow } from "./d1-mock.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const ADMIN_TOKEN = "test-admin-token";

/**
 * 按 Pages Functions 的约定调用 handler：优先 onRequestGet / onRequestPost，
 * 否则回落到 onRequest（内部自行分发）。
 */
async function callApi(modulePath, { method = "GET", url = "/api", body, token, params = {}, env = {} } = {}) {
  const handlers = await import(modulePath);
  const named = method === "GET" ? handlers.onRequestGet : method === "POST" ? handlers.onRequestPost : null;
  const handler = named || handlers.onRequest;
  assert.ok(handler, `${modulePath} 没有导出可用的 handler`);
  const request = new Request(`https://hub.test${url}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "cf-connecting-ip": "203.0.113.9",
      "user-agent": "node-test"
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const response = await handler({ request, env, params, waitUntil() {}, next: async () => new Response("next") });
  return { response, payload: await response.json().catch(() => null) };
}

function apiEnv(db, extra = {}) {
  return { DB: db, ADMIN_TOKEN, ...extra };
}

function seedDatabase(schemes) {
  return new MockD1(
    {
      gun_schemes: schemes,
      scheme_feedback: [],
      audit_logs: [],
      submit_quota: []
    },
    { primaryKeys: { gun_schemes: "id", scheme_feedback: "id", audit_logs: "id" } }
  );
}

const FIXTURES = [
  schemeRow({ id: "s1", weapon_name: "M4A1 满改", object_name: "M4A1", weapon_type: "步枪", game: "delta", mode: "operations", value_score: 500, price: 400000, usage_count: 900, like_count: 20, author_name: "阿甲", gun_code: "M4A1-烽火地带-AAA-111" }),
  schemeRow({ id: "s2", weapon_name: "QCQ171 腰射", object_name: "QCQ171冲锋枪", weapon_type: "冲锋枪", game: "delta", mode: "operations", value_score: 637, price: 754839, usage_count: 50544, like_count: 124, author_name: "南波万", gun_code: "QCQ171冲锋枪-烽火地带-BBB-222" }),
  schemeRow({ id: "s3", weapon_name: "AKM 中配", object_name: "AKM", weapon_type: "步枪", game: "delta", mode: "warfare", value_score: 300, price: 120000, usage_count: 120, like_count: 5, author_name: "阿甲", gun_code: "AKM-全面战场-CCC-333" }),
  schemeRow({ id: "s4", weapon_name: "Vandal 标准", object_name: "Vandal", weapon_type: "步枪", game: "valorant", mode: "standard", value_score: 0, price: 0, usage_count: 40, like_count: 2, author_name: "瓦罗兰特", gun_code: "Vandal-标准模式-DDD-444" }),
  schemeRow({ id: "s5", weapon_name: "待审方案", object_name: "测试枪", weapon_type: "步枪", game: "delta", mode: "operations", status: "pending", value_score: 10, usage_count: 0, gun_code: "测试枪-烽火地带-EEE-555" }),
  schemeRow({ id: "s6", weapon_name: "已下架方案", object_name: "测试枪", weapon_type: "手枪", game: "delta", mode: "operations", status: "hidden", value_score: 10, usage_count: 3, gun_code: "测试枪-烽火地带-FFF-666" })
];

test("列表默认只返回已发布方案，并按热度降序", async () => {
  const env = apiEnv(seedDatabase(FIXTURES));
  const { response, payload } = await callApi("../functions/api/schemes/index.js", { url: "/api/schemes", env });
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.items.map((item) => item.id), ["s2", "s1", "s3", "s4"]);
  assert.equal(payload.total, 4);
  assert.equal(payload.hasMore, false);
  assert.equal(payload.sort, "hot");
});

test("游戏、模式、类型与关键词筛选可以叠加", async () => {
  const env = apiEnv(seedDatabase(FIXTURES));
  const valorant = await callApi("../functions/api/schemes/index.js", { url: "/api/schemes?game=valorant", env });
  assert.deepEqual(valorant.payload.items.map((item) => item.id), ["s4"]);
  assert.equal(valorant.payload.items[0].gameLabel, "无畏契约");

  const warfare = await callApi("../functions/api/schemes/index.js", { url: "/api/schemes?mode=warfare", env });
  assert.deepEqual(warfare.payload.items.map((item) => item.id), ["s3"]);
  assert.equal(warfare.payload.items[0].modeLabel, "全面战场");

  const typeAndQuery = await callApi("../functions/api/schemes/index.js", {
    url: "/api/schemes?type=%E6%AD%A5%E6%9E%AA&q=M4",
    env
  });
  assert.deepEqual(typeAndQuery.payload.items.map((item) => item.id), ["s1"]);
  const byAuthor = await callApi("../functions/api/schemes/index.js", { url: "/api/schemes?author=%E9%98%BF%E7%94%B2", env });
  assert.deepEqual(byAuthor.payload.items.map((item) => item.id).sort(), ["s1", "s3"]);

  const byValue = await callApi("../functions/api/schemes/index.js", { url: "/api/schemes?minValue=600", env });
  assert.deepEqual(byValue.payload.items.map((item) => item.id), ["s2"]);
});

test("LIKE 通配符被转义，不会因为 % 或 _ 而扫全表", async () => {
  const env = apiEnv(seedDatabase(FIXTURES));
  const percent = await callApi("../functions/api/schemes/index.js", { url: "/api/schemes?q=%25", env });
  assert.equal(percent.payload.total, 0);

  const underscore = await callApi("../functions/api/schemes/index.js", { url: "/api/schemes?q=_", env });
  assert.equal(underscore.payload.total, 0);

  const partial = await callApi("../functions/api/schemes/index.js", { url: "/api/schemes?q=QCQ", env });
  assert.deepEqual(partial.payload.items.map((item) => item.id), ["s2"]);
});

test("分页与排序参数生效且被限制在安全范围内", async () => {
  const env = apiEnv(seedDatabase(FIXTURES));
  const first = await callApi("../functions/api/schemes/index.js", { url: "/api/schemes?limit=2", env });
  assert.equal(first.payload.items.length, 2);
  assert.equal(first.payload.hasMore, true);

  const second = await callApi("../functions/api/schemes/index.js", { url: "/api/schemes?limit=2&offset=2", env });
  assert.deepEqual(second.payload.items.map((item) => item.id), ["s3", "s4"]);

  const cheapest = await callApi("../functions/api/schemes/index.js", { url: "/api/schemes?sort=name", env });
  assert.deepEqual(cheapest.payload.items.map((item) => item.weapon), ["AKM 中配", "M4A1 满改", "QCQ171 腰射", "Vandal 标准"]);

  const clamped = await callApi("../functions/api/schemes/index.js", { url: "/api/schemes?limit=999", env });
  assert.equal(clamped.payload.limit, 60);
});

test("关键词没有命中时返回空列表而不是报错", async () => {
  const env = apiEnv(seedDatabase(FIXTURES));
  const { response, payload } = await callApi("../functions/api/schemes/index.js", { url: "/api/schemes?q=不存在的枪", env });
  assert.equal(response.status, 200);
  assert.deepEqual(payload.items, []);
  assert.equal(payload.total, 0);
  assert.equal(payload.hasMore, false);
});

test("详情返回参数、反馈统计与同类推荐，拒绝非 active 方案", async () => {
  const db = seedDatabase(FIXTURES);
  db.tables.scheme_feedback.push(
    { id: "f1", scheme_id: "s1", feedback_type: "good", client_hash: "a", created_at: "2026-08-02T00:00:00.000Z" },
    { id: "f2", scheme_id: "s1", feedback_type: "good", client_hash: "b", created_at: "2026-08-02T00:00:00.000Z" },
    { id: "f3", scheme_id: "s1", feedback_type: "invalid", client_hash: "c", created_at: "2026-08-02T00:00:00.000Z" }
  );
  const env = apiEnv(db);

  const detail = await callApi("../functions/api/schemes/[id].js", { url: "/api/schemes/s1", params: { id: "s1" }, env });
  assert.equal(detail.response.status, 200);
  assert.equal(detail.payload.scheme.id, "s1");
  assert.equal(detail.payload.scheme.params.control, 60);
  assert.equal(detail.payload.scheme.feedback.good, 2);
  assert.equal(detail.payload.scheme.feedback.invalid, 1);
  assert.deepEqual(detail.payload.related.map((item) => item.id), ["s3", "s4"]);

  const pending = await callApi("../functions/api/schemes/[id].js", { url: "/api/schemes/s5", params: { id: "s5" }, env });
  assert.equal(pending.response.status, 404);
  assert.equal(pending.payload.error, "not_found");
});

test("meta 接口给出筛选面与热门作者", async () => {
  const env = apiEnv(seedDatabase(FIXTURES));
  const { response, payload } = await callApi("../functions/api/meta.js", { url: "/api/meta", env });
  assert.equal(response.status, 200);
  assert.equal(payload.total, 4);
  assert.deepEqual(payload.games.map((item) => item.id), ["delta", "valorant"]);
  assert.equal(payload.facets.types[0].name, "步枪");
  assert.equal(payload.facets.types[0].count, 3);
  assert.equal(payload.topAuthors[0].name, "阿甲");
  assert.equal(payload.topAuthors[0].count, 2);
});

test("投稿进入 pending，重复分享码被拒绝，限额按客户端累计", async () => {
  const db = seedDatabase(FIXTURES);
  const env = apiEnv(db);
  const submission = {
    game: "delta",
    mode: "operations",
    weapon: "新方案",
    type: "步枪",
    code: "M4A1-烽火地带-NEW-CODE-1",
    value: 123,
    price: 456,
    author: "投稿者",
    params: { control: 66, stability: 44, recoil: "57" }
  };

  const created = await callApi("../functions/api/schemes/submit.js", { method: "POST", url: "/api/schemes/submit", body: submission, env });
  assert.equal(created.response.status, 201);
  assert.equal(created.payload.status, "pending");
  const stored = db.tables.gun_schemes.find((row) => row.id === created.payload.id);
  assert.equal(stored.status, "pending");
  assert.equal(stored.source, "user");
  assert.equal(JSON.parse(stored.extra_json).params.control, 66);
  assert.equal(db.tables.audit_logs.at(-1).action, "submit");

  const duplicate = await callApi("../functions/api/schemes/submit.js", { method: "POST", url: "/api/schemes/submit", body: submission, env });
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.payload.error, "duplicate_code");

  for (let index = 0; index < 7; index += 1) {
    const result = await callApi("../functions/api/schemes/submit.js", {
      method: "POST",
      url: "/api/schemes/submit",
      body: { ...submission, code: `M4A1-烽火地带-NEW-CODE-${index + 2}` },
      env
    });
    assert.equal(result.response.status, 201, `第 ${index + 2} 条投稿应当被接受`);
  }
  const limited = await callApi("../functions/api/schemes/submit.js", {
    method: "POST",
    url: "/api/schemes/submit",
    body: { ...submission, code: "M4A1-烽火地带-OVER-QUOTA" },
    env
  });
  assert.equal(limited.response.status, 429);
  assert.equal(limited.payload.error, "rate_limited");
});

test("投稿校验拒绝非法分享码与非法游戏", async () => {
  const env = apiEnv(seedDatabase(FIXTURES));
  const bad = await callApi("../functions/api/schemes/submit.js", {
    method: "POST",
    url: "/api/schemes/submit",
    body: { weapon: "x", code: "javascript:alert(1)", game: "csgo" },
    env
  });
  assert.equal(bad.response.status, 400);
  assert.equal(bad.payload.error, "invalid_submission");
  assert.ok(bad.payload.details.length >= 2);
});

test("反馈去重、累加点赞并且不接受未知类型", async () => {
  const db = seedDatabase(FIXTURES);
  const env = apiEnv(db);

  const created = await callApi("../functions/api/schemes/feedback.js", {
    method: "POST",
    url: "/api/schemes/feedback",
    body: { schemeId: "s1", type: "good" },
    env
  });
  assert.equal(created.response.status, 201);
  assert.equal(db.tables.gun_schemes.find((row) => row.id === "s1").like_count, 21);

  const duplicate = await callApi("../functions/api/schemes/feedback.js", {
    method: "POST",
    url: "/api/schemes/feedback",
    body: { schemeId: "s1", type: "good" },
    env
  });
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.payload.error, "duplicate_feedback");

  const invalidType = await callApi("../functions/api/schemes/feedback.js", {
    method: "POST",
    url: "/api/schemes/feedback",
    body: { schemeId: "s1", type: "like" },
    env
  });
  assert.equal(invalidType.response.status, 400);

  const missingScheme = await callApi("../functions/api/schemes/feedback.js", {
    method: "POST",
    url: "/api/schemes/feedback",
    body: { schemeId: "s5", type: "good" },
    env
  });
  assert.equal(missingScheme.response.status, 404);
});

test("管理接口需要令牌，并且只允许合法的状态流转", async () => {
  const db = seedDatabase(FIXTURES);
  const env = apiEnv(db);

  const unauthorized = await callApi("../functions/api/admin/schemes.js", { url: "/api/admin/schemes", env });
  assert.equal(unauthorized.response.status, 401);

  const list = await callApi("../functions/api/admin/schemes.js", { url: "/api/admin/schemes?status=pending", token: ADMIN_TOKEN, env });
  assert.equal(list.response.status, 200);
  assert.deepEqual(list.payload.items.map((item) => item.id), ["s5"]);
  assert.equal(list.payload.stats.active, 4);
  assert.equal(list.payload.stats.pending, 1);
  assert.equal(list.payload.statusFilter, "pending");

  const approved = await callApi("../functions/api/admin/review.js", {
    method: "POST",
    url: "/api/admin/review",
    token: ADMIN_TOKEN,
    body: { schemeId: "s5", action: "approve", note: "参数合理" },
    env
  });
  assert.equal(approved.response.status, 200);
  assert.equal(approved.payload.from, "pending");
  assert.equal(approved.payload.status, "active");
  assert.equal(db.tables.gun_schemes.find((row) => row.id === "s5").status, "active");
  assert.equal(db.tables.audit_logs.at(-1).action, "approve");

  const conflict = await callApi("../functions/api/admin/review.js", {
    method: "POST",
    url: "/api/admin/review",
    token: ADMIN_TOKEN,
    body: { schemeId: "s5", action: "approve" },
    env
  });
  assert.equal(conflict.response.status, 409);
  assert.equal(conflict.payload.error, "invalid_transition");

  const hidden = await callApi("../functions/api/admin/review.js", {
    method: "POST",
    url: "/api/admin/review",
    token: ADMIN_TOKEN,
    body: { schemeId: "s1", action: "hide" },
    env
  });
  assert.equal(hidden.payload.status, "hidden");

  const restored = await callApi("../functions/api/admin/review.js", {
    method: "POST",
    url: "/api/admin/review",
    token: ADMIN_TOKEN,
    body: { schemeId: "s1", action: "restore" },
    env
  });
  assert.equal(restored.payload.status, "active");

  const unknownAction = await callApi("../functions/api/admin/review.js", {
    method: "POST",
    url: "/api/admin/review",
    token: ADMIN_TOKEN,
    body: { schemeId: "s1", action: "delete" },
    env
  });
  assert.equal(unknownAction.response.status, 400);
});

test("未配置 ADMIN_TOKEN 时管理接口关闭，未绑定 DB 时返回 503", async () => {
  const db = seedDatabase(FIXTURES);
  const noToken = await callApi("../functions/api/admin/schemes.js", { url: "/api/admin/schemes", env: { DB: db, ADMIN_TOKEN: "" } });
  assert.equal(noToken.response.status, 503);
  assert.equal(noToken.payload.error, "admin_token_missing");

  const noDb = await callApi("../functions/api/schemes/index.js", { url: "/api/schemes", env: {} });
  assert.equal(noDb.response.status, 503);
  assert.equal(noDb.payload.error, "db_unbound");
});

test("方法不允许时返回 405 并带 Allow 头", async () => {
  const env = apiEnv(seedDatabase(FIXTURES));
  const { response, payload } = await callApi("../functions/api/schemes/index.js", { method: "POST", url: "/api/schemes", body: {}, env });
  assert.equal(response.status, 405);
  assert.equal(payload.error, "method_not_allowed");
  assert.equal(response.headers.get("allow"), "GET");
});

test("种子数据可以覆盖真实的 1313 条方案", async (t) => {
  const file = path.join(ROOT, "public", "data", "schemes.json");
  if (!fs.existsSync(file)) {
    t.skip("缺少 public/data/schemes.json");
    return;
  }
  const schemes = JSON.parse(fs.readFileSync(file, "utf8"));
  const rows = schemes.map((scheme, index) => schemeRow({
    id: scheme.id || `orzice-${index}`,
    game: scheme.game,
    mode: scheme.mode,
    weapon_name: scheme.weapon,
    object_name: scheme.objectName,
    weapon_type: scheme.type,
    value_score: Number(scheme.value) || 0,
    price: Number(scheme.price) || 0,
    usage_count: Number(scheme.users) || 0,
    like_count: Number(scheme.likes) || 0,
    author_name: scheme.author,
    gun_code: scheme.code,
    extra_json: JSON.stringify({ params: scheme.params || {} })
  }));
  const env = apiEnv(seedDatabase(rows));

  const all = await callApi("../functions/api/meta.js", { url: "/api/meta", env });
  assert.equal(all.payload.total, schemes.length);

  const page = await callApi("../functions/api/schemes/index.js", { url: "/api/schemes?limit=60", env });
  assert.equal(page.payload.items.length, 60);
  assert.equal(page.payload.total, schemes.length);
  assert.equal(page.payload.hasMore, true);

  const delta = await callApi("../functions/api/schemes/index.js", { url: "/api/schemes?game=delta&limit=1", env });
  const deltaCount = rows.filter((row) => row.game === "delta").length;
  assert.equal(delta.payload.total, deltaCount);
});
