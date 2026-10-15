#!/usr/bin/env node
// 用真实数据把配装站的关键视图渲染成静态 HTML 预览，便于截图核对视觉。
// 仅用于本地检查；它直接复用 public/hub/app.js 的渲染函数，所以预览与线上不会走样。
//
// 用法：
//   node scripts/build-hub-preview.mjs [baseUrl] [adminToken]
//
// 需要运行中的本地服务器（npm run dev:local），默认 http://127.0.0.1:8788。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, ".shots");
const BASE = (process.argv[2] || "http://127.0.0.1:8788").replace(/\/$/, "");
const TOKEN = process.argv[3] || "";

// 必须在导入 app.js 之前置位，否则模块会尝试自行启动并绑定事件。
globalThis.__HUB_PREVIEW__ = true;
const hub = await import(pathToFileURL(path.join(ROOT, "public", "hub", "app.js")).href);

async function api(route) {
  const response = await fetch(`${BASE}${route}`, {
    headers: TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(`${route} -> HTTP ${response.status} ${payload?.error || ""}`);
  }
  return payload;
}

function wrap(title, body) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>${title}</title>
<link rel="stylesheet" href="../public/hub/hub.css">
</head><body>${body}</body></html>`;
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const written = [];

const meta = await api("/api/meta");
const list = await api("/api/schemes?limit=24");
hub.applyForPreview({ meta, list, route: "browse" });

// 详情抽屉
const first = list.items[0];
const detail = await api(`/api/schemes/${encodeURIComponent(first.id)}`);
hub.applyForPreview({ detail, route: "detail", routeId: first.id });
fs.writeFileSync(path.join(OUT_DIR, "preview-detail.html"), wrap("配装详情抽屉", hub.renderPreview("detail")), "utf8");
written.push("preview-detail.html");

// 投稿页
hub.applyForPreview({ route: "submit" });
fs.writeFileSync(path.join(OUT_DIR, "preview-submit.html"), wrap("投稿配装方案", hub.renderPreview("submit")), "utf8");
written.push("preview-submit.html");

// 审核台：清掉详情抽屉，避免它盖住表格右侧的操作列。
if (TOKEN) {
  const queue = await api("/api/admin/schemes?status=pending&limit=20");
  hub.applyForPreview({
    admin: { ...queue, token: TOKEN, status: "pending" },
    route: "admin",
    detail: null,
    routeId: null
  });
  const adminHtml = wrap("审核台", hub.renderPreview("admin"));
  fs.writeFileSync(path.join(OUT_DIR, "preview-admin.html"), adminHtml, "utf8");
  written.push("preview-admin.html");
} else {
  hub.applyForPreview({ admin: { items: [], stats: {}, total: 0, token: "" }, route: "admin" });
  fs.writeFileSync(path.join(OUT_DIR, "preview-admin-login.html"), wrap("审核台登录", hub.renderPreview("admin")), "utf8");
  written.push("preview-admin-login.html");
}

console.log(`已生成 ${written.length} 个预览页：`);
for (const file of written) console.log(`  .shots/${file}`);
