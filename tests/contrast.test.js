import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const css = fs.readFileSync(path.join(ROOT, "public", "hub", "hub.css"), "utf8");

/** WCAG 相对亮度。 */
function luminance(hex) {
  const channels = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((s) => (s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** 取出某个主题块内的变量值。 */
function themeVars(marker) {
  const start = css.indexOf(marker);
  assert.ok(start >= 0, `找不到 ${marker}`);
  const block = css.slice(start, css.indexOf("}", start));
  const vars = {};
  for (const match of block.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    vars[match[1]] = match[2].toLowerCase();
  }
  return vars;
}

/**
 * 回归：暗色主题的主色曾经是 #7d6cf0，白色按钮文字对比度只有 3.98，
 * 低于 WCAG AA 的 4.5。这里直接对变量取值做检查，不依赖浏览器。
 */
test("两套主题的主色都能承载白色文字（对比度 >= 4.5）", () => {
  for (const marker of [':root[data-theme="light"]', ':root[data-theme="dark"]']) {
    const vars = themeVars(marker);
    assert.ok(vars["--violet"], `${marker} 缺少 --violet`);
    const ratio = contrast(vars["--violet"], vars["--on-accent"] || "#ffffff");
    assert.ok(ratio >= 4.5,
      `${marker} 的 --violet ${vars["--violet"]} 与白色文字对比度仅 ${ratio.toFixed(2)}，应 >= 4.5`);
  }
});

test("暗色主题的正文与面板背景对比度达标", () => {
  const vars = themeVars(':root[data-theme="dark"]');
  for (const [foreground, background] of [["--ink", "--canvas"], ["--ink", "--panel"], ["--muted", "--panel"]]) {
    assert.ok(vars[foreground] && vars[background], `缺少 ${foreground} 或 ${background}`);
    const ratio = contrast(vars[foreground], vars[background]);
    // 次要文字（--muted）放宽到 3.5，正文要求 4.5
    const required = foreground === "--muted" ? 3.5 : 4.5;
    assert.ok(ratio >= required,
      `${foreground}(${vars[foreground]}) 与 ${background}(${vars[background]}) 对比度 ${ratio.toFixed(2)}，应 >= ${required}`);
  }
});

/**
 * 回归：`.button:hover` 与 `.button.primary` 优先级相同（都是 0,2,0），
 * 而通用悬停规则写在后面，会把主按钮的紫色底换成浅色面板色，
 * 白色文字随之消失（实测对比度只有 1.04）。
 */
test("主按钮的悬停态必须显式声明底色，不能被通用悬停规则覆盖", () => {
  const genericHover = /\.button:hover:not\(:disabled\)\s*\{/.exec(css);
  const primary = /\.button\.primary\s*\{/.exec(css);
  const primaryHover = /\.button\.primary:hover[^{]*\{([^}]*)\}/.exec(css);
  assert.ok(genericHover, "找不到通用悬停规则");
  assert.ok(primary, "找不到 .button.primary");
  assert.ok(primaryHover, "缺少 .button.primary:hover，悬停时底色会被通用规则覆盖");
  assert.ok(primary.index > genericHover.index, "预期 .button.primary 写在通用悬停规则之后");
  assert.ok(primaryHover.index > primary.index, "主按钮悬停规则应写在 .button.primary 之后");
  assert.match(primaryHover[1], /background:\s*var\(--violet\)/,
    "主按钮悬停态必须重新声明 background: var(--violet)");
});

/** 紫色文字压在暗色面板上时必须够亮（--violet 为承载白字而偏暗，不能兼作文字色）。 */
test("紫色文字与暗色面板对比度达标", () => {
  const vars = themeVars(':root[data-theme="dark"]');
  assert.ok(vars["--violet-text"], "暗色主题缺少 --violet-text");
  const ratio = contrast(vars["--violet-text"], vars["--panel"]);
  assert.ok(ratio >= 4.5,
    `--violet-text ${vars["--violet-text"]} 与面板 ${vars["--panel"]} 对比度 ${ratio.toFixed(2)}，应 >= 4.5`);
});
