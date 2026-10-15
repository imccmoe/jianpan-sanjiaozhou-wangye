import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

/** 取出某个选择器块内的 --变量名。 */
function varsIn(css, startMarker, endMarker) {
  const start = css.indexOf(startMarker);
  assert.ok(start >= 0, `找不到 ${startMarker}`);
  const sliced = endMarker ? css.slice(start, css.indexOf(endMarker, start)) : css.slice(start);
  return [...sliced.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((match) => match[1]);
}

function assertThemeParity(label, css, lightMarker, darkMarker) {
  const light = new Set(varsIn(css, lightMarker, darkMarker));
  const dark = new Set(varsIn(css, darkMarker));
  assert.ok(light.size > 5, `${label}：亮色主题变量过少（${light.size}）`);
  assert.ok(dark.size > 5, `${label}：暗色主题变量过少（${dark.size}）`);

  const onlyLight = [...light].filter((name) => !dark.has(name));
  const onlyDark = [...dark].filter((name) => !light.has(name));
  assert.deepEqual(onlyLight, [], `${label}：这些变量只在亮色主题定义，暗色下会取不到值`);
  assert.deepEqual(onlyDark, [], `${label}：这些变量只在暗色主题定义，亮色下会取不到值`);
}

test("hub.css 的亮/暗主题定义了完全相同的变量集合", () => {
  assertThemeParity("hub.css", read("public/hub/hub.css"), ':root[data-theme="light"]', ':root[data-theme="dark"]');
});

test("styles.css（键盘页）的亮/暗主题定义了完全相同的变量集合", () => {
  assertThemeParity("styles.css", read("public/styles.css"), ':root[data-theme="light"]', ':root[data-theme="dark"]');
});

test("两套样式表都没有自引用变量", () => {
  for (const file of ["public/hub/hub.css", "public/styles.css"]) {
    const css = read(file);
    const broken = [...css.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*var\(\1\)\s*;/gm)].map((match) => match[1]);
    assert.deepEqual(broken, [], `${file} 存在自引用变量：${broken.join(", ")}`);
  }
});

test("样式表正文不再散落硬编码颜色（除变量定义块外）", () => {
  for (const file of ["public/hub/hub.css", "public/styles.css"]) {
    const css = read(file);
    // 去掉 :root 变量定义块后，正文里不应再有 hex 颜色
    const body = css.replace(/:root[^{]*\{[^}]*\}/gs, "");
    const hex = [...body.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) => match[0]);
    assert.deepEqual([...new Set(hex)], [], `${file} 正文仍有硬编码颜色：${[...new Set(hex)].join(" ")}`);
  }
});

test("两个页面都在样式表之前设置 data-theme，避免主题闪烁", () => {
  for (const file of ["public/hub/index.html", "public/keyboard.html"]) {
    const html = read(file);
    const scriptAt = html.indexOf("dataset.theme");
    const linkAt = html.search(/<link[^>]+stylesheet/);
    assert.ok(scriptAt > 0, `${file} 缺少主题引导脚本`);
    assert.ok(linkAt > 0, `${file} 缺少样式表引用`);
    assert.ok(scriptAt < linkAt, `${file} 的主题脚本必须在样式表之前执行`);
    assert.match(html, /prefers-color-scheme: dark/, `${file} 引导脚本未读取系统偏好`);
    assert.match(html, /zh-hub-theme/, `${file} 引导脚本未读取已保存的主题`);
  }
});

test("theme.js 的三档模式与持久化键在 hub 与键盘页之间保持一致", () => {
  const hubTheme = read("public/hub/theme.js");
  const rootTheme = read("public/theme.js");
  assert.equal(rootTheme, hubTheme, "public/theme.js 与 public/hub/theme.js 内容不一致，应保持同步");
  assert.match(hubTheme, /export const THEME_MODES = \["auto", "light", "dark"\]/);
  assert.match(hubTheme, /export const THEME_KEY = "zh-hub-theme"/);
  // 引导脚本里的键与模式判断必须与模块一致
  const bootstrapKey = /localStorage\.getItem\("([^"]+)"\)/.exec(read("public/hub/index.html"))?.[1];
  assert.equal(bootstrapKey, "zh-hub-theme");
});

test("主题切换只有一条触发路径，避免重复绑定导致跳过模式", () => {
  // 回归：键盘页曾经既在 [data-action] 分发里处理 toggle-theme，
  // 又额外给按钮绑了一次 switchTheme，一次点击触发两次，auto 直接跳到 dark。
  const keyboard = read("public/app.js");
  const directBindings = [...keyboard.matchAll(/addEventListener\("click",\s*switchTheme\)/g)];
  assert.equal(directBindings.length, 0, "不应再直接给主题按钮绑定 switchTheme");
  assert.match(keyboard, /if \(action === "toggle-theme"\) return switchTheme\(\);/,
    "handleAction 必须处理 toggle-theme");

  const hub = read("public/hub/app.js");
  const hubHandlers = [...hub.matchAll(/data-action="toggle-theme"/g)];
  assert.equal(hubHandlers.length, 1, `hub 的主题按钮应只有一个，实际 ${hubHandlers.length}`);
  assert.match(hub, /if \(action === "toggle-theme"\)/, "hub 缺少 toggle-theme 分发");
});

test("切换主题不得重建页面（否则会清空正在录制的交互状态）", () => {
  const keyboard = read("public/app.js");
  // switchTheme 函数体内不能出现 render( 调用
  const body = /function switchTheme\(\)\s*\{([\s\S]*?)\n\}/.exec(keyboard)?.[1] || "";
  assert.ok(body.length > 0, "找不到 switchTheme 实现");
  assert.ok(!/\brender\(/.test(body), "switchTheme 内不应调用 render()");
});
