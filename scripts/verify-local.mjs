#!/usr/bin/env node
// 对已经运行中的本地服务器（wrangler pages dev 或 scripts/smoke-test.mjs）做真实 HTTP 验收。
//
// 用法：
//   node scripts/verify-local.mjs [baseUrl] [adminToken]
//
// 与 scripts/smoke-test.mjs 的区别：本脚本不自带服务器、不自带假数据库，
// 它验证的是「真实运行时 + 真实 D1」这条链路，包含写入与状态流转。

const BASE = (process.argv[2] || "http://127.0.0.1:8788").replace(/\/$/, "");
const ADMIN_TOKEN = process.argv[3] || process.env.ADMIN_TOKEN || "";

let passed = 0;
const failures = [];
const notes = [];

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

function note(message) {
  notes.push(message);
  console.log(`  · ${message}`);
}

async function request(path, { method = "GET", body, headers = {} } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = text;
  }
  return { status: response.status, payload, headers: response.headers, text };
}

async function main() {
  console.log(`验收目标：${BASE}${ADMIN_TOKEN ? "（带管理令牌）" : "（无管理令牌）"}`);

  console.log("\n[静态资源]");
  for (const [path, needle] of [
    ["/", "ZFQ 站点导航"],
    ["/hub/", "ZFQ 配装方案站"],
    ["/hub/hub.css", "--violet"],
    ["/hub/api.js", "admin/review"],
    ["/hub/app.js", "hashchange"],
    ["/hub/format.js", "barWidth"],
    ["/keyboard", "SJZ 三键音乐键盘"],
    ["/styles.css", "--violet"],
    ["/app.js", "loadCatalog"],
    ["/device.js", "APP_PID"],
    ["/firmware.js", "decryptFirmware"],
    ["/music-engine.js", "compileSong"],
    ["/data/music-catalog.json", "\"songs\""],
    ["/firmware/CH32V203C8T.enc.hex", "GXM-AES128-GCM-HEX-V1"]
  ]) {
    const result = await request(path);
    check(`${path}（HTTP ${result.status}）`, result.status === 200 && String(result.text).includes(needle),
      result.status !== 200 ? `期望 200` : `未包含 ${needle}`);
  }

  console.log("\n[Pages Functions 与 D1]");
  const meta = await request("/api/meta");
  check("GET /api/meta 返回 200", meta.status === 200, `实际 ${meta.status} ${JSON.stringify(meta.payload).slice(0, 120)}`);
  const total = meta.payload?.total || 0;
  check("D1 中有种子数据", total > 1000, `total=${total}`);
  note(`方案总数 ${total}；类型分布前 3：${(meta.payload?.facets?.types || []).slice(0, 3).map((t) => `${t.label} ${t.count}`).join("、")}`);
  note(`游戏分布：${(meta.payload?.facets?.games || []).map((g) => `${g.label} ${g.count}`).join("、")}`);

  const list = await request("/api/schemes?limit=6");
  check("GET /api/schemes 返回 200", list.status === 200, `实际 ${list.status}`);
  check("列表返回 6 条", list.payload?.items?.length === 6, `实际 ${list.payload?.items?.length}`);
  check("按热度降序", (list.payload?.items || []).every((item, index, arr) => index === 0 || arr[index - 1].users >= item.users));
  check("列表项包含分享码与图片", Boolean(list.payload?.items?.[0]?.code));

  const filtered = await request("/api/schemes?game=valorant&limit=5");
  check("game=valorant 过滤生效", filtered.payload?.items?.length > 0 && filtered.payload.items.every((i) => i.game === "valorant"),
    `返回 ${filtered.payload?.items?.length} 条`);

  const warfare = await request("/api/schemes?mode=warfare&limit=3");
  check("mode=warfare 过滤生效", warfare.payload?.items?.every((i) => i.mode === "warfare"));

  const searched = await request("/api/schemes?q=QCQ171&limit=5");
  check("中文/英文关键词搜索命中", searched.payload?.total > 0, `total=${searched.payload?.total}`);

  const wildcard = await request("/api/schemes?q=%25&limit=5");
  check("通配符 % 被转义（不返回全部）", wildcard.payload?.total === 0, `total=${wildcard.payload?.total}`);

  const byType = await request("/api/schemes?type=%E6%AD%A5%E6%9E%AA&limit=3");
  check("中文类型筛选生效", byType.payload?.items?.every((i) => i.type === "步枪"));

  const sorted = await request("/api/schemes?sort=name&limit=3");
  check("sort=name 生效", sorted.payload?.sort === "name");

  const clamped = await request("/api/schemes?limit=9999");
  check("limit 被限制为 60", clamped.payload?.limit === 60, `实际 ${clamped.payload?.limit}`);

  console.log("\n[详情]");
  const first = list.payload.items[0];
  const detail = await request(`/api/schemes/${encodeURIComponent(first.id)}`);
  check("GET /api/schemes/:id 返回 200", detail.status === 200, `实际 ${detail.status}`);
  check("详情含改装参数", Object.keys(detail.payload?.scheme?.params || {}).length > 0,
    JSON.stringify(detail.payload?.scheme?.params));
  note(`样例：${detail.payload?.scheme?.weapon} → ${Object.entries(detail.payload?.scheme?.params || {}).slice(0, 4).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  check("详情含反馈统计字段", detail.payload?.scheme?.feedback !== undefined);
  check("详情含同类推荐", Array.isArray(detail.payload?.related));
  const missing = await request("/api/schemes/__no_such_scheme__");
  check("不存在的方案返回 404", missing.status === 404, `实际 ${missing.status}`);

  console.log("\n[写入链路：投稿 → 审核 → 公开]");
  const stamp = Date.now().toString(36);
  const submission = {
    game: "delta", mode: "operations", weapon: `本地验收方案 ${stamp}`, type: "步枪",
    code: `验收方案-烽火地带-LOCAL-${stamp.toUpperCase()}`, author: "本地验收",
    value: 123456, price: 654321, sensitivity: "仅在训练场校准过",
    params: { control: 66, stability: 44, hip: 33, range: 22, ads: 11, recoil: "57" }
  };
  const created = await request("/api/schemes/submit", { method: "POST", body: submission });
  check("投稿返回 201", created.status === 201, `实际 ${created.status} ${JSON.stringify(created.payload).slice(0, 160)}`);
  const newId = created.payload?.id;
  check("投稿状态为 pending", created.payload?.status === "pending");

  if (newId) {
    const hidden = await request(`/api/schemes/${newId}`);
    check("待审方案不对外可见（404）", hidden.status === 404, `实际 ${hidden.status}`);

    const duplicate = await request("/api/schemes/submit", { method: "POST", body: submission });
    check("重复分享码被拒绝（409）", duplicate.status === 409, `实际 ${duplicate.status}`);

    const invalid = await request("/api/schemes/submit", {
      method: "POST", body: { weapon: "x", code: "not-a-code", game: "csgo" }
    });
    check("非法投稿返回 400", invalid.status === 400, `实际 ${invalid.status}`);

    const listAfter = await request(`/api/schemes?q=${encodeURIComponent(stamp)}`);
    check("待审方案不出现在公开列表", listAfter.payload?.total === 0, `total=${listAfter.payload?.total}`);

    if (ADMIN_TOKEN) {
      const auth = { authorization: `Bearer ${ADMIN_TOKEN}` };
      const queue = await request("/api/admin/schemes?status=pending&limit=50", { headers: auth });
      check("管理台可读取待审队列", queue.status === 200, `实际 ${queue.status}`);
      check("队列包含刚投稿的方案", (queue.payload?.items || []).some((item) => item.id === newId));

      const approved = await request("/api/admin/review", {
        method: "POST", headers: auth, body: { schemeId: newId, action: "approve", note: "本地验收" }
      });
      check("审核通过返回 200", approved.status === 200, `实际 ${approved.status}`);
      check("状态变为 active", approved.payload?.status === "active");

      const nowPublic = await request(`/api/schemes/${newId}`);
      check("通过后可公开访问", nowPublic.status === 200, `实际 ${nowPublic.status}`);
      check("详情参数与投稿一致", nowPublic.payload?.scheme?.params?.control === 66,
        JSON.stringify(nowPublic.payload?.scheme?.params));

      const like = await request("/api/schemes/feedback", {
        method: "POST", body: { schemeId: newId, type: "good" }
      });
      check("可提交反馈（201）", like.status === 201, `实际 ${like.status}`);
      const likeAgain = await request("/api/schemes/feedback", {
        method: "POST", body: { schemeId: newId, type: "good" }
      });
      check("同类反馈去重（409）", likeAgain.status === 409, `实际 ${likeAgain.status}`);
      const withFeedback = await request(`/api/schemes/${newId}`);
      check("点赞数已累加", withFeedback.payload?.scheme?.feedback?.good === 1,
        JSON.stringify(withFeedback.payload?.scheme?.feedback));

      const reviewTwice = await request("/api/admin/review", {
        method: "POST", headers: auth, body: { schemeId: newId, action: "approve" }
      });
      check("重复审核被拒绝（409）", reviewTwice.status === 409, `实际 ${reviewTwice.status}`);

      const drop = await request("/api/admin/review", {
        method: "POST", headers: auth, body: { schemeId: newId, action: "hide" }
      });
      check("下架返回 200", drop.status === 200, `实际 ${drop.status}`);
      const afterHide = await request(`/api/schemes/${newId}`);
      check("下架后不可公开访问（404）", afterHide.status === 404, `实际 ${afterHide.status}`);

      const restore = await request("/api/admin/review", {
        method: "POST", headers: auth, body: { schemeId: newId, action: "restore" }
      });
      check("恢复返回 200", restore.status === 200, `实际 ${restore.status}`);

      const noAuth = await request("/api/admin/schemes");
      check("无令牌访问管理接口返回 401", noAuth.status === 401, `实际 ${noAuth.status}`);
      note(`已留下一条验收数据：${newId}（当前 active，可用管理台下架）`);
    } else {
      const queue = await request("/api/admin/schemes", { headers: { authorization: "Bearer wrong" } });
      const adminClosed = queue.status === 503 || queue.status === 401;
      check("未配置令牌时管理接口关闭", adminClosed, `实际 ${queue.status}`);
      note("未提供管理令牌，跳过审核流转部分；用 npm run dev:local 会自动生成一个令牌");
    }
  }

  console.log("\n[边界与安全]");
  const badMethod = await request("/api/schemes", { method: "POST", body: {} });
  check("错误方法返回 405", badMethod.status === 405, `实际 ${badMethod.status}`);
  check("405 带 Allow 头", badMethod.headers.get("allow") === "GET", badMethod.headers.get("allow") || "无");

  const badJson = await fetch(`${BASE}/api/schemes/feedback`, {
    method: "POST", headers: { "content-type": "application/json" }, body: "{ broken"
  });
  check("非法 JSON 返回 400", badJson.status === 400, `实际 ${badJson.status}`);

  const oversize = await fetch(`${BASE}/api/schemes/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ schemeId: "x", type: "good", note: "y".repeat(20000) })
  });
  check("超大请求体被拒绝（413）", oversize.status === 413, `实际 ${oversize.status}`);

  const xss = await request(`/api/schemes?q=${encodeURIComponent("<img src=x onerror=alert(1)>")}`);
  check("恶意关键词不触发 500", xss.status === 200, `实际 ${xss.status}`);

  const jsonHeaders = await request("/api/meta");
  check("API 响应带 nosniff", jsonHeaders.headers.get("x-content-type-options") === "nosniff");
  check("API 响应不可缓存", (jsonHeaders.headers.get("cache-control") || "").includes("no-store"));

  console.log(`\n通过 ${passed} 项，失败 ${failures.length} 项`);
  if (notes.length) console.log(`备注 ${notes.length} 条`);
  if (failures.length) {
    console.log("\n失败明细：");
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exitCode = 1;
  }
}

await main();
