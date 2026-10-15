#!/usr/bin/env node
// 把 public/data/schemes.json 转成 D1 可执行的 SQL 种子文件。
//
// 用法：
//   node scripts/build-d1-seed.mjs                       # 输出 seeds/0002_seed_schemes.sql
//   node scripts/build-d1-seed.mjs out/seed.sql 200      # 自定义输出路径与每批行数
//
// 之后执行：
//   npx wrangler d1 execute wy-zfq-config-hub --remote --file seeds/0002_seed_schemes.sql
//
// 说明：种子数据来自社区公开分享码（source=orzice-authorized）。
// 故意不放在 migrations/ 下：`wrangler d1 migrations apply` 会执行该目录下所有 .sql，
// 那样每次迁移都会重灌 1313 条静态数据，把用户投稿后的状态改回去。
// 该文件是可再生的构建产物，已在 .gitignore 中忽略。
// 测试可以导入 buildSeed() 直接复用同一套字段处理逻辑。

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const COLUMNS = [
  "id", "game", "mode", "weapon_name", "object_name", "weapon_type", "ammo", "map", "image",
  "value_score", "price", "usage_count", "like_count", "author_name", "gun_code",
  "adapter_config", "sensitivity_note", "status", "source", "source_id", "extra_json"
];

const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
const number = (value) => {
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
};

/** 只保留可检索或可展示的附加字段，避免把 2MB 的 raw 灌进 D1。 */
export function extraJson(scheme) {
  const params = scheme.params && typeof scheme.params === "object" ? scheme.params : {};
  const cleanParams = Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== "")
  );
  const payload = { params: cleanParams };
  if (scheme.feedback && typeof scheme.feedback === "object") payload.feedback = scheme.feedback;
  if (scheme.sourceId) payload.sourceUrl = `https://orzice.com/v/gun_gqm?id=${scheme.sourceId}`;
  return JSON.stringify(payload);
}

function rowValues(scheme, index) {
  const id = String(scheme.id || `orzice-row-${index + 1}`);
  return [
    quote(id),
    quote(scheme.game || "delta"),
    quote(scheme.mode || "operations"),
    quote(scheme.weapon || "未知枪械"),
    quote(scheme.objectName || scheme.weapon || "未知枪械"),
    quote(scheme.type || "步枪"),
    quote(scheme.ammo || ""),
    quote(scheme.map || ""),
    quote(scheme.image || ""),
    number(scheme.value),
    number(scheme.price),
    number(scheme.users),
    number(scheme.likes),
    quote(scheme.author || ""),
    quote(scheme.code || ""),
    "''",
    quote(scheme.sensitivity || ""),
    quote("active"),
    quote(scheme.source || "orzice-authorized"),
    scheme.sourceId ? quote(String(scheme.sourceId)) : "NULL",
    quote(extraJson(scheme))
  ];
}

/**
 * 生成种子 SQL 文本。
 * @param {Array<object>} schemes 规范化后的方案数组
 * @param {{ batchSize?: number, sourceLabel?: string }} [options]
 */
export function buildSeed(schemes, { batchSize = 30, sourceLabel = "public/data/schemes.json" } = {}) {
  if (!Array.isArray(schemes)) throw new TypeError("schemes 必须是数组");
  const size = Math.max(1, Number(batchSize) || 30);
  const lines = [
    "-- 由 scripts/build-d1-seed.mjs 自动生成，请勿手工编辑。",
    `-- 源文件：${sourceLabel}（${schemes.length} 条）`,
    ""
  ];

  const knownIds = new Set();
  let written = 0;
  for (let start = 0; start < schemes.length; start += size) {
    const chunk = schemes.slice(start, start + size);
    const rows = chunk.map((scheme, offset) => {
      const index = start + offset;
      let id = String(scheme.id || `orzice-row-${index + 1}`);
      // 主键冲突会让整批失败，这里对重复 id 做一次显式去重。
      if (knownIds.has(id)) id = `${id}-${index + 1}`;
      knownIds.add(id);
      written += 1;
      return `  (${rowValues({ ...scheme, id }, index).join(", ")})`;
    });
    lines.push(`INSERT OR REPLACE INTO gun_schemes (${COLUMNS.join(", ")}) VALUES`);
    lines.push(`${rows.join(",\n")};`);
    lines.push("");
  }

  return { sql: `${lines.join("\n")}\n`, rows: written };
}

function main() {
  const ROOT = process.cwd();
  const source = process.env.SEED_SOURCE || path.join(ROOT, "public", "data", "schemes.json");
  const output = process.argv[2] || path.join("seeds", "0002_seed_schemes.sql");
  const batchSize = Number(process.argv[3]) || 30;

  if (!fs.existsSync(source)) {
    console.error(`找不到源数据：${source}`);
    process.exit(1);
  }
  const schemes = JSON.parse(fs.readFileSync(source, "utf8"));
  if (!Array.isArray(schemes)) {
    console.error("schemes.json 顶层必须是数组");
    process.exit(1);
  }

  const { sql, rows } = buildSeed(schemes, { batchSize, sourceLabel: path.relative(ROOT, source) });
  const target = path.isAbsolute(output) ? output : path.join(ROOT, output);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, sql, "utf8");

  const kb = (fs.statSync(target).size / 1024).toFixed(1);
  console.log(`已生成 ${path.relative(ROOT, target)}：${rows} 行 / ${kb} KB，每批 ${batchSize} 行`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
