#!/usr/bin/env node
// 本地一键启动 Cloudflare Pages + D1 开发服务器。
//
// 用法：
//   node scripts/dev-local.mjs [port]
//
// 它做三件事：
//   1. 把 workerd/miniflare 的临时目录指向仓库内（.wrangler-local/tmp）——
//      这是关键修复：workerd 默认在 os.tmpdir() 下创建 miniflare-email-store，
//      而 %LOCALAPPDATA%\Temp 在受限环境下不可写，会直接启动失败
//      （kj/filesystem-disk-win32.c++: CreateDirectory: #5 拒绝访问）；
//   2. 首次运行时生成 .dev.vars 并写入随机 ADMIN_TOKEN（已被 .gitignore 忽略）；
//   3. 以继承 stdio 的方式启动 `wrangler pages dev`，并把令牌打印出来。
//
// 对应 npm 脚本：npm run dev  /  npm run dev:local
//
// 默认把本地 D1 持久化在 .wrangler-local/persist（用 --persist-to 显式指定），
// 这样数据库位置不随 wrangler 版本变化。若希望沿用 wrangler 默认的
// `~/.wrangler` 状态目录，设置 SJZ_WRANGLER_STATE=default。

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORK_DIR = path.join(ROOT, ".wrangler-local");
const PERSIST_DIR = path.join(WORK_DIR, "persist");
const TMP_DIR = path.join(WORK_DIR, "tmp");
const DEV_VARS = path.join(ROOT, ".dev.vars");
const PORT = process.argv[2] || process.env.PORT || "8788";
const USE_DEFAULT_STATE = (process.env.SJZ_WRANGLER_STATE || "").toLowerCase() === "default";

for (const dir of [PERSIST_DIR, TMP_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

let adminToken = "";
if (fs.existsSync(DEV_VARS)) {
  const existing = /^ADMIN_TOKEN=(.+)$/m.exec(fs.readFileSync(DEV_VARS, "utf8"));
  adminToken = existing ? existing[1].trim() : "";
}
if (!adminToken) {
  adminToken = `local-${crypto.randomBytes(12).toString("hex")}`;
  const body = [
    "# 本地开发用环境变量（已被 .gitignore 忽略）。",
    "# 生产环境的令牌请用：npx wrangler pages secret put ADMIN_TOKEN",
    `ADMIN_TOKEN=${adminToken}`,
    ""
  ].join("\n");
  fs.writeFileSync(DEV_VARS, body, "utf8");
  console.log(`已生成 .dev.vars，管理令牌：${adminToken}`);
} else {
  console.log(`使用已有 .dev.vars 中的管理令牌：${adminToken}`);
}

const wrangler = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
if (!fs.existsSync(wrangler)) {
  console.error("未找到 wrangler，请先执行：npm install");
  process.exit(1);
}

const args = [
  wrangler, "pages", "dev", "public",
  "--port", String(PORT),
  "--compatibility-date=2026-08-12"
];
if (!USE_DEFAULT_STATE) args.push("--persist-to", PERSIST_DIR);

console.log(`\n启动地址：http://127.0.0.1:${PORT}`);
console.log(`审核台：  http://127.0.0.1:${PORT}/hub/#/admin`);
console.log(`本地 D1： ${USE_DEFAULT_STATE ? "wrangler 默认状态目录（~/.wrangler）" : path.relative(ROOT, PERSIST_DIR)}`);
console.log("提示：先执行 npm run db:migrate:local 与 npm run db:seed 准备本地数据。\n");

const child = spawn(process.execPath, args, {
  cwd: ROOT,
  // 继承 stdio：受限沙箱禁止用管道捕获子进程输出，inherit 不受影响。
  stdio: "inherit",
  env: {
    ...process.env,
    // workerd 与 miniflare 的临时目录必须可写，这是启动成败的关键。
    TMPDIR: TMP_DIR,
    TMP: TMP_DIR,
    TEMP: TMP_DIR
  }
});

child.on("exit", (code) => {
  process.exitCode = code ?? 0;
});
