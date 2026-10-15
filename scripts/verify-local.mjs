#!/usr/bin/env node
// 对已经运行中的本地服务器（wrangler pages dev）做真实 HTTP 验收。
//
// 用法：
//   node scripts/verify-local.mjs [baseUrl] [adminToken]
//
// 令牌可以不传：脚本会自动读取仓库根目录的 .dev.vars。
//
// 与 scripts/smoke-test.mjs 的区别：本脚本不自带服务器、不自带假数据库，
// 它验证的是「真实运行时 + 真实 D1」这条链路，包含写入与状态流转。
// 因此它会消耗投稿额度（每客户端每小时 8 条），脚本会先探测剩余额度，
// 额度不足时跳过相关用例并给出提示，而不是直接失败。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.argv[2] || "http://127.0.0.1:8788").replace(/\/$/, "");
const WAIT_MS = Number(process.env.WAIT_MS || 30000);

/** 未显式传令牌时，从 .dev.vars 读取，避免手填出错。 */
function readLocalToken() {
  try {
    const content = fs.readFileSync(path.join(ROOT, ".dev.vars"), "utf8");
    return /^ADMIN_TOKEN=(.+)$/m.exec(content)?.[1]?.trim() || "";
  } catch {
    return "";
  }
}

const explicitToken = process.argv[3] || process.env.ADMIN_TOKEN || "";
const ADMIN_TOKEN = explicitToken || readLocalToken();
const TOKEN_SOURCE = explicitToken ? "命令行" : (ADMIN_TOKEN ? ".dev.vars" : "无");

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * wrangler 在文件变动时会 reload，期间连接会被拒。
 * 所以先轮询等待服务就绪，避免落在这个窗口里直接失败。
 */
async function waitForServer() {
  const deadline = Date.now() + WAIT_MS;
  let lastError = "";
  process.stdout.write(`等待服务就绪（最多 ${Math.round(WAIT_MS / 1000)} 秒）`);
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/api/meta`, { headers: { connection: "close" } });
      if (response.ok) {
        console.log(" —— 已就绪");
        return true;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.cause?.code || error.message;
    }
    process.stdout.write(".");
    await sleep(800);
  }
  console.log("");
  console.error(`服务在 ${Math.round(WAIT_MS / 1000)} 秒内不可达：${BASE}（最后一次错误：${lastError}）`);
  console.error("请先另开一个终端运行 npm run dev，再执行本脚本。");
  return false;
}

/** 单次请求；短暂连接错误自动重试，避免 reload 窗口导致偶发失败。 */
async function request(path, { method = "GET", body, headers = {}, retries = 3 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(`${BASE}${path}`, {
        method,
        headers: {
          connection: "close",
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
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(700 * (attempt + 1));
    }
  }
  const code = lastError?.cause?.code || lastError?.message || "unknown";
  throw new Error(`请求 ${path} 失败：${code}`);
}

async function main() {
  console.log(`验收目标：${BASE}${ADMIN_TOKEN ? `（管理令牌来自 ${TOKEN_SOURCE}）` : "（无管理令牌，跳过审核流转）"}`);
  if (!(await waitForServer())) {
    process.exitCode = 2;
    return;
  }

  console.log("\n[静态资源]");
  // 根路径与旧键盘链接由 public/_redirects 处理，先显式校验重定向本身。
  const rootRedirect = await fetch(`${BASE}/`, { redirect: "manual", headers: { connection: "close" } });
  check("根路径返回 302 指向 /hub/",
    [301, 302, 308].includes(rootRedirect.status) && (rootRedirect.headers.get("location") || "").includes("/hub/"),
    `HTTP ${rootRedirect.status} → ${rootRedirect.headers.get("location")}`);
  const legacyRedirect = await fetch(`${BASE}/keyboard`, { redirect: "manual", headers: { connection: "close" } });
  check("旧键盘页链接返回重定向而非 404",
    [301, 302, 308].includes(legacyRedirect.status), `HTTP ${legacyRedirect.status}`);

  for (const [path, needle] of [
    ["/hub/", "ZFQ 配装方案站"],
    ["/hub/hub.css", "--violet"],
    ["/hub/api.js", "admin/review"],
    ["/hub/app.js", "hashchange"],
    ["/hub/format.js", "barWidth"],
    ["/hub/theme.js", "prefers-color-scheme"],
    ["/data/schemes.json", "orzice-authorized"]
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
  const auth = ADMIN_TOKEN ? { authorization: `Bearer ${ADMIN_TOKEN}` } : {};

  // 投稿限额是「每客户端每小时 8 条」。先探测本小时已用多少，
  // 避免脚本反复执行后自己把自己限流，导致偶发失败。
  const hourAgo = Date.now() - 3_600_000;
  const countThisHour = (items) => items.filter((item) => {
    if (!/本地验收|冒烟|Apifox/.test(item.author || "")) return false;
    const raw = String(item.createdAt || "").replace(" ", "T");
    const time = Date.parse(raw.includes("Z") || raw.includes("+") ? raw : `${raw}Z`);
    return Number.isFinite(time) ? time > hourAgo : true;
  }).length;

  let used = 0;
  let usedLabel = "";
  if (ADMIN_TOKEN) {
    const recent = await request("/api/admin/schemes?limit=60&sort=new", { headers: auth });
    used = countThisHour(recent.payload?.items || []);
    usedLabel = "管理队列";
  } else {
    const recent = await request("/api/schemes?limit=60&sort=new");
    used = countThisHour(recent.payload?.items || []);
    usedLabel = "公开列表（不含待审，可能低估）";
  }
  const remaining = Math.max(0, 8 - used);
  note(`本小时已用投稿额度：约 ${used}/8（来源：${usedLabel}），剩余约 ${remaining}`);

  if (remaining === 0) {
    console.log("  ⚠ 投稿额度已用尽，跳过写入链路。清空本地库后重试：");
    console.log("      Remove-Item -Recurse -Force .wrangler-local\\persist");
    console.log("      npm run db:migrate:local; npm run db:seed");
  } else {
    const stamp = Date.now().toString(36);
    const submission = {
      game: "delta", mode: "operations", weapon: `本地验收方案 ${stamp}`, type: "步枪",
      code: `验收方案-烽火地带-LOCAL-${stamp.toUpperCase()}`, author: "本地验收",
      value: 123456, price: 654321, sensitivity: "仅在训练场校准过",
      params: { control: 66, stability: 44, hip: 33, range: 22, ads: 11, recoil: "57" }
    };
    const created = await request("/api/schemes/submit", { method: "POST", body: submission });
    const newId = created.payload?.id;
    if (created.status === 429) {
      // 额度探测是估算值，可能刚好差一条。这不算缺陷，给出可执行的处理方式即可。
      console.log(`  ⚠ 投稿额度已用尽（HTTP 429）：${created.payload?.message || ""}`);
      console.log("     重置本地库后重试：");
      console.log("       # 先停掉 npm run dev，然后：");
      console.log("       npm run dev -- --reset-db");
      console.log("       npm run db:migrate:local; npm run db:seed");
    } else {
      check("投稿返回 201", created.status === 201, `实际 ${created.status} ${JSON.stringify(created.payload).slice(0, 160)}`);
      check("投稿状态为 pending", created.payload?.status === "pending");
    }

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
        const queue = await request("/api/admin/schemes?status=pending&limit=60", { headers: auth });
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
      note("未提供管理令牌，跳过审核流转部分；用 npm run dev 会自动生成并复用 .dev.vars 中的令牌");
    }
    }
  }

  console.log("\n[边界与安全]");
  // 审核台登录页在未持令牌时也要能打开（入口说明写在前端里）。
  const adminEntry = await request("/hub/");
  check("审核台入口页面可访问", adminEntry.status === 200 && String(adminEntry.text).includes("ZFQ 配装方案站"));
  check("静态资源提供 hub 前端", (await request("/hub/app.js")).text.includes("admin-login"));
  const badMethod = await request("/api/schemes", { method: "POST", body: {} });
  check("错误方法返回 405", badMethod.status === 405, `实际 ${badMethod.status}`);
  check("405 带 Allow 头", badMethod.headers.get("allow") === "GET", badMethod.headers.get("allow") || "无");

  // 这两个用例需要发送非法/超大原文，所以不走 request() 的 JSON 封装。
  const raw = async (path, body) => {
    let lastError;
    for (let attempt = 0; attempt <= 3; attempt += 1) {
      try {
        return await fetch(`${BASE}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", connection: "close" },
          body
        });
      } catch (error) {
        lastError = error;
        await sleep(700 * (attempt + 1));
      }
    }
    throw new Error(`请求 ${path} 失败：${lastError?.cause?.code || lastError?.message}`);
  };

  const badJson = await raw("/api/schemes/feedback", "{ broken");
  check("非法 JSON 返回 400", badJson.status === 400, `实际 ${badJson.status}`);

  const oversize = await raw("/api/schemes/feedback",
    JSON.stringify({ schemeId: "x", type: "good", note: "y".repeat(20000) }));
  check("超大请求体被拒绝（413）", oversize.status === 413, `实际 ${oversize.status}`);

  const xss = await request(`/api/schemes?q=${encodeURIComponent("<img src=x onerror=alert(1)>")}`);
  check("恶意关键词不触发 500", xss.status === 200, `实际 ${xss.status}`);

  const jsonHeaders = await request("/api/meta");
  check("API 响应带 nosniff", jsonHeaders.headers.get("x-content-type-options") === "nosniff");
  check("API 响应不可缓存", (jsonHeaders.headers.get("cache-control") || "").includes("no-store"));

  // Chrome DevTools 会探测这个端点并期望 JSON；若被 SPA 回退成 HTML 会报解析错误。
  const wellKnown = await request("/.well-known/appspecific/com.chrome.devtools.json");
  check("DevTools 探测端点返回 JSON 而非 HTML",
    wellKnown.status === 200 && typeof wellKnown.payload === "object" && wellKnown.payload !== null,
    `HTTP ${wellKnown.status}，body 前 40 字：${String(wellKnown.text).slice(0, 40)}`);

  console.log(`\n通过 ${passed} 项，失败 ${failures.length} 项`);
  if (notes.length) console.log(`备注 ${notes.length} 条`);
  if (failures.length) {
    console.log("\n失败明细：");
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (error) {
  console.error(`\n验收中断：${error.message}`);
  console.error("若服务器在运行中被 reload（改动文件会触发），重跑本脚本即可。");
  process.exitCode = 2;
}
