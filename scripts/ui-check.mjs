#!/usr/bin/env node
// 用 Chrome DevTools Protocol 真实驱动浏览器，验证配装站的关键交互。
//
// 用法：
//   node scripts/ui-check.mjs [baseUrl]
//
// 覆盖：首屏渲染、点击顶部「审核台」是否切换路由、提交 token 后能否进入队列、
// 以及过程中的 console 错误与页面异常。
// 需要本机有 Edge 或 Chrome（自动探测）。

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.argv[2] || "http://127.0.0.1:8788").replace(/\/$/, "");
const PORT = 9333;

const CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
];
const browser = CANDIDATES.find((candidate) => fs.existsSync(candidate));
if (!browser) {
  console.error("未找到 Edge/Chrome");
  process.exit(2);
}

const profile = path.join(os.tmpdir(), `ui-check-${process.pid}`);
const child = spawn(browser, [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
  "--no-first-run", "--no-default-browser-check",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  "about:blank"
], { stdio: "ignore" });

const results = [];
const consoleErrors = [];
function check(label, condition, detail = "") {
  results.push({ label, ok: Boolean(condition), detail });
  console.log(`  ${condition ? "✔" : "✖"} ${label}${detail && !condition ? ` — ${detail}` : ""}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForDevtools() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (response.ok) return;
    } catch { /* 还没起来 */ }
    await sleep(500);
  }
  throw new Error("DevTools 端点未就绪");
}

let nextId = 1;
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const pending = new Map();
    const listeners = [];
    socket.addEventListener("open", () => resolve({
      send(method, params = {}) {
        const id = nextId++;
        socket.send(JSON.stringify({ id, method, params }));
        return new Promise((res, rej) => pending.set(id, { res, rej }));
      },
      on(handler) { listeners.push(handler); },
      close() { socket.close(); }
    }));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const { res, rej } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) rej(new Error(message.error.message));
        else res(message.result);
        return;
      }
      for (const handler of listeners) handler(message);
    });
    socket.addEventListener("error", reject);
  });
}

const evaluate = (client, expression) => client.send("Runtime.evaluate", {
  expression, returnByValue: true, awaitPromise: true
}).then((result) => result.result?.value);

async function main() {
  await waitForDevtools();
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = targets.find((target) => target.type === "page");
  const client = await connect(page.webSocketDebuggerUrl);

  client.on((message) => {
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "));
    }
    if (message.method === "Runtime.exceptionThrown") {
      consoleErrors.push(message.params.exceptionDetails.exception?.description || "exception");
    }
  });
  await client.send("Runtime.enable");
  await client.send("Page.enable");

  console.log(`驱动浏览器：${path.basename(browser)} → ${BASE}`);

  // 1) 首屏
  await client.send("Page.navigate", { url: `${BASE}/hub/` });
  await sleep(3500);
  const firstScreen = await evaluate(client, `(() => ({
    hasTopbar: !!document.querySelector('.topbar'),
    links: [...document.querySelectorAll('.topbar nav a')].map(a => ({ text: a.textContent.trim(), href: a.getAttribute('href') })),
    cards: document.querySelectorAll('.card').length,
    heading: document.querySelector('h1')?.textContent || ''
  }))()`);
  check("首屏渲染出顶部导航", firstScreen?.hasTopbar, JSON.stringify(firstScreen));
  check("卡片列表有数据", firstScreen?.cards > 0, `cards=${firstScreen?.cards}`);
  const adminLink = (firstScreen?.links || []).find((link) => link.text === "审核台");
  check("顶部导航存在「审核台」链接", Boolean(adminLink), JSON.stringify(firstScreen?.links));

  // 2) 点击「审核台」——这是用户报告失败的路径
  await evaluate(client, `(() => {
    const link = [...document.querySelectorAll('.topbar nav a')].find(a => a.textContent.trim() === '审核台');
    if (!link) return 'no-link';
    link.click();
    return 'clicked';
  })()`);
  await sleep(2500);
  const afterClick = await evaluate(client, `(() => ({
    hash: location.hash,
    hasLoginForm: !!document.querySelector('#admin-login'),
    hasTokenInput: !!document.querySelector('#admin-token'),
    hasHint: document.body.innerText.includes('令牌从哪来'),
    heading: document.querySelector('h1')?.textContent || ''
  }))()`);
  check("点击后 URL hash 变为 #/admin", afterClick?.hash?.includes("admin"), `hash=${afterClick?.hash}`);
  check("点击后出现登录表单", afterClick?.hasLoginForm, JSON.stringify(afterClick));
  check("登录页显示令牌来源说明", afterClick?.hasHint, JSON.stringify(afterClick));

  // 3) 直接打开 /hub/?#/admin（用户写的 URL 形式）
  await client.send("Page.navigate", { url: `${BASE}/hub/?#/admin` });
  await sleep(3000);
  const direct = await evaluate(client, `(() => ({
    hasLoginForm: !!document.querySelector('#admin-login'),
    heading: document.querySelector('h1')?.textContent || ''
  }))()`);
  check("直接打开 /hub/?#/admin 也进入审核台", direct?.hasLoginForm, JSON.stringify(direct));

  // 4) 填入错误 token，应出现表单内错误提示
  await evaluate(client, `(() => {
    const input = document.querySelector('#admin-token');
    if (!input) return 'no-input';
    input.value = 'wrong-token-123';
    document.querySelector('#admin-login').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    return 'submitted';
  })()`);
  await sleep(2500);
  const afterWrong = await evaluate(client, `(() => ({
    hasLoginForm: !!document.querySelector('#admin-login'),
    errorText: document.querySelector('#admin-error')?.textContent?.trim() || ''
  }))()`);
  check("错误令牌后仍留在登录页并给出提示",
    afterWrong?.hasLoginForm && afterWrong.errorText.length > 0, JSON.stringify(afterWrong));

  // 5) 填入正确 token，应进入审核台队列
  const token = readLocalToken();
  if (token) {
    await evaluate(client, `(() => {
      const input = document.querySelector('#admin-token');
      if (!input) return 'no-input';
      input.value = ${JSON.stringify(token)};
      document.querySelector('#admin-login').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      return 'submitted';
    })()`);
    await sleep(3000);
    const afterRight = await evaluate(client, `(() => ({
      hasTable: !!document.querySelector('.admin-table'),
      hasStatusSelect: !!document.querySelector('#admin-status'),
      stats: document.querySelector('.heading p')?.textContent?.trim() || '',
      hasLogout: !!document.querySelector('[data-action="admin-logout"]')
    }))()`);
    check("正确令牌后进入审核台队列", afterRight?.hasTable || afterRight?.hasStatusSelect, JSON.stringify(afterRight));
    check("审核台显示各状态统计", /已发布/.test(afterRight?.stats || ""), afterRight?.stats);
    check("审核台有退出登录", afterRight?.hasLogout, JSON.stringify(afterRight));
  } else {
    console.log("  · 未找到 .dev.vars 令牌，跳过登录成功路径");
  }

  check("过程中没有未捕获的 JS 错误", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

  client.close();
}

function readLocalToken() {
  try {
    const content = fs.readFileSync(path.join(process.cwd(), ".dev.vars"), "utf8");
    return /^ADMIN_TOKEN=(.+)$/m.exec(content)?.[1]?.trim() || "";
  } catch {
    return "";
  }
}

try {
  await main();
} catch (error) {
  console.error(`UI 检查中断：${error.message}`);
  process.exitCode = 2;
} finally {
  child.kill();
  await sleep(300);
  fs.rmSync(profile, { recursive: true, force: true });
}

const failed = results.filter((result) => !result.ok);
console.log(`\n通过 ${results.length - failed.length} 项，失败 ${failed.length} 项`);
if (failed.length) process.exitCode = 1;
