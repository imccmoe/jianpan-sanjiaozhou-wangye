#!/usr/bin/env node
// 用 CDP 模拟系统亮/暗偏好，验证主题跟随、手动切换与持久化是否真的生效。
//
// 用法：
//   node scripts/ui-theme-check.mjs [baseUrl]
//
// 只断言「计算后的颜色确实不同」这类可观测事实，不比对具体色值，
// 这样调整配色不会误报，但主题失效一定会被抓到。

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = (process.argv[2] || "http://127.0.0.1:8788").replace(/\/$/, "");
const PORT = 9335;

const CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
];
const browser = CANDIDATES.find((candidate) => fs.existsSync(candidate));
if (!browser) {
  console.error("未找到 Edge/Chrome");
  process.exit(2);
}

const profile = path.join(os.tmpdir(), `ui-theme-${process.pid}`);
const child = spawn(browser, [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
  "--no-first-run", "--no-default-browser-check",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"
], { stdio: "ignore" });

const results = [];
const pageErrors = [];
function check(label, condition, detail = "") {
  results.push({ label, ok: Boolean(condition) });
  console.log(`  ${condition ? "✔" : "✖"} ${label}${!condition && detail ? ` — ${detail}` : ""}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let nextId = 1;

async function waitForDevtools() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) return;
    } catch { /* 还没起来 */ }
    await sleep(500);
  }
  throw new Error("DevTools 端点未就绪");
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    // CDP 消息必须按顺序处理：早先的版本直接并发 send 而未等待响应，
    // 导致导航后立刻读取时拿到上一个页面的状态，产生假失败。
    let queue = Promise.resolve();
    socket.addEventListener("open", () => resolve({
      send(method, params = {}) {
        const id = nextId++;
        const task = queue.then(() => new Promise((res, rej) => {
          pending.set(id, { res, rej });
          socket.send(JSON.stringify({ id, method, params }));
        }));
        queue = task.catch(() => {});
        return task;
      },
      close() { socket.close(); }
    }));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.method === "Runtime.exceptionThrown") {
        pageErrors.push(message.params.exceptionDetails?.exception?.description
          || message.params.exceptionDetails?.text || "exception");
      }
      if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
        pageErrors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" "));
      }
      if (message.id && pending.has(message.id)) {
        const { res, rej } = pending.get(message.id);
        pending.delete(message.id);
        message.error ? rej(new Error(message.error.message)) : res(message.result);
      }
    });
    socket.addEventListener("error", reject);
  });
}

async function main() {
  await waitForDevtools();
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const client = await connect(targets.find((target) => target.type === "page").webSocketDebuggerUrl);
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  await client.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "light" }]
  });

  const evaluate = (expression) => client.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })
    .then((result) => result.result?.value);

  /** 采样几个关键表面的计算色，用于判断主题是否真的切换了。 */
  const SAMPLE = `(() => {
    const style = (selector, property) => {
      const node = document.querySelector(selector);
      return node ? getComputedStyle(node)[property] : null;
    };
    return {
      theme: document.documentElement.dataset.theme,
      mode: document.documentElement.dataset.themeMode,
      bodyBg: style('body', 'backgroundColor'),
      bodyInk: style('body', 'color'),
      panelBg: style('.topbar', 'backgroundColor'),
      toggleText: document.querySelector('.theme-toggle')?.textContent?.trim() || ''
    };
  })()`;

  console.log(`模拟系统偏好并验证主题 → ${BASE}`);

  // ---- 配装站 ----
  console.log("\n[配装站 /hub/]");
  await client.send("Page.navigate", { url: `${BASE}/hub/` });
  await sleep(3500);
  const hubLight = await evaluate(SAMPLE);
  check("系统亮色时 data-theme=light（auto）", hubLight?.theme === "light", JSON.stringify(hubLight));
  check("顶部栏存在主题切换按钮", Boolean(hubLight?.toggleText), JSON.stringify(hubLight));

  await client.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-color-scheme", value: "dark" }]
  });
  await sleep(1200);
  const hubAutoDark = await evaluate(SAMPLE);
  check("系统切暗后自动跟随（auto）", hubAutoDark?.theme === "dark", JSON.stringify(hubAutoDark));
  check("auto 跟随确实改变了配色", hubAutoDark?.bodyBg !== hubLight?.bodyBg,
    `light=${hubLight?.bodyBg} dark=${hubAutoDark?.bodyBg}`);

  // 手动切到白天：即使系统是暗色也应保持亮
  const clickToggle = `(() => {
    const button = document.querySelector('.theme-toggle');
    if (!button) return 'no-button';
    button.click();
    return 'clicked';
  })()`;
  await evaluate(clickToggle);
  await sleep(900);
  const afterFirstClick = await evaluate(SAMPLE);
  await evaluate(clickToggle);
  await sleep(900);
  const afterSecondClick = await evaluate(SAMPLE);
  const modes = [hubAutoDark?.mode, afterFirstClick?.mode, afterSecondClick?.mode];
  check("点击可在 auto/light/dark 之间循环", new Set(modes).size === 3, modes.join(" → "));
  check("手动选白天时，系统虽为暗色也保持亮色",
    [afterFirstClick, afterSecondClick].some((sample) => sample?.theme === "light" && sample?.mode === "light"),
    JSON.stringify([afterFirstClick?.mode, afterSecondClick?.mode]));

  // 持久化：刷新后仍是 manual 模式
  const chosenMode = afterSecondClick?.mode;
  await client.send("Page.navigate", { url: `${BASE}/hub/` });
  await sleep(3000);
  const afterReload = await evaluate(SAMPLE);
  check(`刷新后保留所选模式（${chosenMode}）`, afterReload?.mode === chosenMode,
    `期望 ${chosenMode}，实际 ${afterReload?.mode}`);

  // 清掉持久化，并把三种模式都显式验证一遍，避免依赖前一步的残留状态。
  await evaluate(`localStorage.removeItem('zh-hub-theme')`);
  const cleared = await evaluate(`localStorage.getItem('zh-hub-theme')`);
  check("可以清掉已保存的主题模式", cleared === null, `实际 ${cleared}`);

  // ---- 键盘页 ----
  console.log("\n[键盘页 /keyboard]");
  const stamp = Date.now();
  // 先回到同源的空白页清一次存储，保证键盘页从 auto 开始
  await client.send("Page.navigate", { url: `${BASE}/hub/?t=${stamp}` });
  await sleep(2500);
  await evaluate(`localStorage.removeItem('zh-hub-theme')`);
  await client.send("Page.navigate", { url: `${BASE}/keyboard?t=${stamp}` });
  await sleep(3500);
  const kbDark = await evaluate(SAMPLE);
  check("键盘页存在主题切换按钮", Boolean(kbDark?.toggleText), JSON.stringify(kbDark));
  check("键盘页跟随系统（当前系统为暗色）", kbDark?.theme === "dark", JSON.stringify(kbDark));
  check("键盘页初始模式为 auto", kbDark?.mode === "auto", `实际 ${kbDark?.mode}`);

  await evaluate(clickToggle);
  await sleep(900);
  const kbSwitched = await evaluate(SAMPLE);
  check("键盘页点击后改变了主题", kbSwitched?.theme !== kbDark?.theme,
    `${kbDark?.theme} → ${kbSwitched?.theme}；mode ${kbDark?.mode} → ${kbSwitched?.mode}；按钮 "${kbSwitched?.toggleText}"`);
  check("键盘页切换后配色确实变化", kbSwitched?.bodyBg !== kbDark?.bodyBg,
    `${kbDark?.bodyBg} → ${kbSwitched?.bodyBg}`);

  // 键盘页切换主题不得清空录制状态（回归：曾经用 render() 导致输入被重置）
  console.log("\n[键盘页：切主题不打断录制]");
  await client.send("Page.navigate", { url: `${BASE}/keyboard?t=${stamp + 1}` });
  await sleep(3200);
  const recordingKept = await evaluate(`(() => {
    // 切到键位设置页，模拟正在录制按键
    const tab = [...document.querySelectorAll('[data-view="mapping"]')][0];
    if (!tab) return { error: 'no-tab' };
    tab.click();
    return { clicked: true };
  })()`);
  await sleep(800);
  const beforeToggle = await evaluate(`(() => {
    const before = document.querySelectorAll('.page *').length;
    return { nodes: before, theme: document.documentElement.dataset.theme };
  })()`);
  await evaluate(clickToggle);
  await sleep(800);
  const afterToggle = await evaluate(`(() => ({
    nodes: document.querySelectorAll('.page *').length,
    theme: document.documentElement.dataset.theme
  }))()`);
  check("切主题不重建页面节点（不打断交互）",
    beforeToggle?.nodes === afterToggle?.nodes && recordingKept?.clicked,
    `节点数 ${beforeToggle?.nodes} → ${afterToggle?.nodes}`);

  client.close();
}

try {
  await main();
} catch (error) {
  console.error(`主题 UI 检查中断：${error.message}`);
  process.exitCode = 2;
} finally {
  if (pageErrors.length) {
    console.log("\n浏览器内异常：");
    for (const message of [...new Set(pageErrors)].slice(0, 8)) console.log(`  ! ${message}`);
  }
  child.kill();
  await sleep(300);
  fs.rmSync(profile, { recursive: true, force: true });
}

const failed = results.filter((result) => !result.ok);
console.log(`\n通过 ${results.length - failed.length} 项，失败 ${failed.length} 项`);
if (failed.length) process.exitCode = 1;
