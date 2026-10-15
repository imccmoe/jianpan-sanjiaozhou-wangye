#!/usr/bin/env node
// 用 git 凭据管理器里已保存的 GitHub 令牌创建远端仓库。
//
// 为什么需要它：git push 能用凭据管理器里的令牌完成认证，
// 但「创建仓库」必须走 API，需要拿到同一个令牌。
// 这里通过 git 的 credential helper 协议把令牌读出来，只用于本次 API 调用，不落盘。
//
// 用法：node scripts/create-remote-repo.mjs <owner/repo> [--private]

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const TARGET = process.argv[2];
const PRIVATE = process.argv.includes("--private");
if (!/^[\w.-]+\/[\w.-]+$/.test(TARGET || "")) {
  console.error("用法：node scripts/create-remote-repo.mjs <owner/repo> [--private]");
  process.exit(1);
}

/** 从 git 凭据管理器读取 github.com 的凭据（只取，不写）。 */
function readCredential() {
  return new Promise((resolve) => {
    // 隔离配置，避免用户全局 credential.helper 之外的东西干扰
    const child = spawn("git", ["-c", "credential.interactive=never", "credential", "fill"], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    let out = "";
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch { /* 已退出 */ }
      resolve(value);
    };
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.stderr.on("data", () => {});
    child.on("error", () => finish(null));
    child.on("close", () => {
      const username = /^username=(.*)$/m.exec(out)?.[1]?.trim() || "";
      const password = /^password=(.*)$/m.exec(out)?.[1]?.trim() || "";
      finish(password ? { username, password } : null);
    });
    child.stdin.end("protocol=https\nhost=github.com\n\n");
    // 凭据管理器若弹窗会卡住，10 秒后放弃
    setTimeout(() => finish(null), 10000);
  });
}

const credential = await readCredential();
if (!credential) {
  console.error("未能从 git 凭据管理器取得令牌（可能需要在交互式终端里完成一次认证）。");
  console.error("可以改为手动创建仓库后再推送，见下方提示。");
  process.exit(2);
}
console.log(`已取得凭据（用户 ${credential.username || "未知"}，令牌长度 ${credential.password.length}）`);

const [owner, name] = TARGET.split("/");
const response = await fetch("https://api.github.com/user/repos", {
  method: "POST",
  headers: {
    authorization: `Bearer ${credential.password}`,
    accept: "application/vnd.github+json",
    "content-type": "application/json",
    "user-agent": "sjz-keyboard-split"
  },
  body: JSON.stringify({
    name,
    private: PRIVATE,
    description: "SJZ 三键音乐键盘网页端：WebHID 写入音乐、键位与灯光配置，并完成固件升级",
    has_issues: true,
    has_wiki: false,
    auto_init: false
  })
});

const payload = await response.json().catch(() => ({}));
if (response.status === 201) {
  console.log(`仓库已创建：${payload.full_name}（${payload.private ? "私有" : "公开"}）`);
  console.log(`clone 地址：${payload.clone_url}`);
} else if (response.status === 422) {
  console.log(`仓库 ${TARGET} 已存在，无需创建。`);
} else {
  console.error(`创建失败：HTTP ${response.status} ${payload.message || ""}`);
  if (response.status === 403) {
    console.error("令牌可能缺少 repo(或 public_repo) 权限，可在 https://github.com/settings/tokens 检查。");
  }
  process.exit(1);
}
