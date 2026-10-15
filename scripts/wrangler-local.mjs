#!/usr/bin/env node
// 统一的 wrangler 入口：把 workerd/miniflare 的临时目录固定到仓库内。
//
// 为什么需要它：workerd 会在 os.tmpdir() 下创建 miniflare-email-store，
// 而 %LOCALAPPDATA%\Temp 在受限环境下不可写，任何直接调用 wrangler 的命令
// （d1 migrations apply / d1 execute / pages dev）都会启动失败并报
// kj/filesystem-disk-win32.c++: CreateDirectory: #5 拒绝访问。
// 只设置 TMP/TEMP 即可解决，不需要改动 WRANGLER_HOME。
//
// 用法（package.json 里的本地命令都走这里）：
//   node scripts/wrangler-local.mjs d1 migrations apply wy-zfq-config-hub --local
//   node scripts/wrangler-local.mjs d1 execute wy-zfq-config-hub --local --file x.sql
//
// 远端命令（`db:*:remote`）不经过本脚本，因为访问远端只需要网络。

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TMP_DIR = path.join(ROOT, ".wrangler-local", "tmp");
const WRANGLER = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");

if (!fs.existsSync(WRANGLER)) {
  console.error("未找到 wrangler，请先执行：npm install");
  process.exit(1);
}

fs.mkdirSync(TMP_DIR, { recursive: true });

const child = spawn(process.execPath, [WRANGLER, ...process.argv.slice(2)], {
  cwd: ROOT,
  // 继承 stdio：受限沙箱禁止用管道捕获子进程输出，inherit 不受影响。
  stdio: "inherit",
  env: { ...process.env, TMPDIR: TMP_DIR, TMP: TMP_DIR, TEMP: TMP_DIR }
});

child.on("exit", (code) => {
  process.exitCode = code ?? 0;
});
