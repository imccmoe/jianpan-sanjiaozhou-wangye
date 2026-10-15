#!/usr/bin/env node
// 截取亮/暗两套主题的页面截图，用于人工核对配色。
// 用 CDP 的 prefers-color-scheme 模拟，因此不需要改系统设置。
//
// 用法：node scripts/theme-shots.mjs [baseUrl]

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.argv[2] || "http://127.0.0.1:8788").replace(/\/$/, "");
const PORT = 9337;
const OUT = path.join(process.cwd(), ".shots");
const browser = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
].find((candidate) => fs.existsSync(candidate));
if (!browser) {
  console.error("未找到 Edge");
  process.exit(2);
}

const profile = path.join(os.tmpdir(), `shots-${process.pid}`);
const child = spawn(browser, ["--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
  "--no-first-run", "--hide-scrollbars", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"],
  { stdio: "ignore" });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let nextId = 1;

async function waitFor() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) return; } catch {}
    await sleep(500);
  }
  throw new Error("devtools not ready");
}

function connect(url) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const pending = new Map();
    let queue = Promise.resolve();
    ws.addEventListener("open", () => resolve({
      send(method, params = {}) {
        const id = nextId++;
        const task = queue.then(() => new Promise((res, rej) => {
          pending.set(id, { res, rej });
          ws.send(JSON.stringify({ id, method, params }));
        }));
        queue = task.catch(() => {});
        return task;
      }
    }));
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id); pending.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result);
      }
    });
  });
}

await waitFor();
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const client = await connect(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await client.send("Page.enable");
await client.send("Runtime.enable");
await client.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
fs.mkdirSync(OUT, { recursive: true });

const PAGES = [
  ["hub", "/hub/"]
];

for (const [name, route] of PAGES) {
  for (const scheme of ["light", "dark"]) {
    await client.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: scheme }]
    });
    // 先访问一次清掉已保存的模式，再重新加载，确保处于 auto 跟随状态。
    // 直接 Page.reload 会因为时序导致截图在主题应用前拍下（曾拍到半成品）。
    await client.send("Page.navigate", { url: `${BASE}${route}?shot=${Date.now()}` });
    await sleep(2500);
    await client.send("Runtime.evaluate", { expression: `localStorage.removeItem('zh-hub-theme')` });
    await client.send("Page.navigate", { url: `${BASE}${route}?shot=${Date.now()}` });
    await sleep(4500);

    const applied = await client.send("Runtime.evaluate", {
      expression: `(() => {
        const root = getComputedStyle(document.documentElement);
        return { theme: document.documentElement.dataset.theme, ink: root.getPropertyValue('--ink').trim() };
      })()`,
      returnByValue: true
    });
    const { theme, ink } = applied.result.value;
    if (theme !== scheme) {
      console.warn(`  ! ${name}/${scheme}：页面主题为 ${theme}，与期望不符`);
    }
    const shot = await client.send("Page.captureScreenshot", { format: "png" });
    const file = path.join(OUT, `${name}-${scheme}.png`);
    fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
    console.log(`  ${path.relative(process.cwd(), file)}  (theme=${theme}, ink=${ink})`);
  }
}

client.close?.();
child.kill();
await sleep(300);
fs.rmSync(profile, { recursive: true, force: true });
console.log("截图完成");
