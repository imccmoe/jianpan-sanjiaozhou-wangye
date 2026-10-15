import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const HUB_APP = path.join(ROOT, "public", "hub", "app.js");
const HUB_FORMAT = path.join(ROOT, "public", "hub", "format.js");
const LANDING = path.join(ROOT, "public", "index.html");
const README = path.join(ROOT, "README.md");

const hubSource = fs.readFileSync(HUB_APP, "utf8");
const formatSource = fs.readFileSync(HUB_FORMAT, "utf8");

test("审核台前端具备完整的登录与审核操作能力", () => {
  // 登录
  assert.match(hubSource, /id="admin-login"/, "缺少登录表单");
  assert.match(hubSource, /hub_admin_token/, "缺少令牌存储键");
  // 登录页要告诉使用者令牌从哪来，否则入口等于死路
  assert.match(hubSource, /\.dev\.vars/, "登录页未说明令牌来源");
  assert.match(hubSource, /admin_token_missing|ADMIN_TOKEN/, "登录页未提及 ADMIN_TOKEN");
  // 审核操作
  for (const action of ["approve", "reject", "hide", "restore"]) {
    assert.match(hubSource, new RegExp(`data-review="${action}"`), `缺少 ${action} 操作按钮`);
  }
  assert.match(hubSource, /data-action="review"/, "缺少审核动作绑定");
  assert.match(hubSource, /id="admin-status"/, "缺少状态筛选");
  assert.match(hubSource, /data-action="admin-logout"/, "缺少退出登录");
  // 状态标签要能显示四种状态（文案定义在 format.js 的 STATUS_LABELS）
  for (const status of ["active", "pending", "rejected", "hidden"]) {
    assert.match(formatSource, new RegExp(`^\\s+${status}:`, "m"), `状态标签缺少 ${status}`);
  }
});

test("审核台有可发现的入口（首页卡片 + 顶部导航 + 文档）", () => {
  const landing = fs.readFileSync(LANDING, "utf8");
  assert.match(landing, /href="\/hub\/#\/admin"/, "首页缺少审核台入口");
  assert.match(hubSource, /\["admin", "#\/admin", "审核台"\]/, "顶部导航缺少审核台链接");

  const readme = fs.readFileSync(README, "utf8");
  assert.match(readme, /\/hub\/#\/admin/, "README 未给出审核台地址");
  assert.match(readme, /ADMIN_TOKEN/, "README 未说明令牌");
});

test("审核台登录失败时给出可读提示而不是静默", () => {
  assert.match(hubSource, /adminError/, "缺少登录错误状态");
  assert.match(hubSource, /令牌无效/, "401 时未给出提示文案");
});

test("所有事件监听都走 document 委托，不绑定到会被重建的元素上", () => {
  // 回归：render() 每次都用 innerHTML 重建 DOM。曾经把 submit/input 监听器
  // 用 querySelector 绑到 #admin-login、#submit-form、#search-input 上，
  // 结果启动时这些元素还不存在（或下一次渲染就被替换），
  // 表现为「填了 token 点提交没反应」「搜索框打不了字」，且无任何报错。
  const listenerTargets = [...hubSource.matchAll(/([\w.$]+)\.addEventListener\(/g)].map((match) => match[1]);
  assert.ok(listenerTargets.length >= 5, `监听器数量异常：${listenerTargets.length}`);
  const nonDelegated = listenerTargets.filter((target) => target !== "document" && target !== "window");
  assert.deepEqual(nonDelegated, [], `以下监听器绑在元素上，会在重渲染后失效：${nonDelegated.join(", ")}`);

  // 表单提交与搜索输入必须在 document 上按 id 分发
  assert.match(hubSource, /document\.addEventListener\("submit"/, "缺少 document 级 submit 委托");
  assert.match(hubSource, /form\?\.id === "admin-login"/, "submit 委托未处理 admin-login");
  assert.match(hubSource, /form\?\.id === "submit-form"/, "submit 委托未处理 submit-form");
  assert.match(hubSource, /document\.addEventListener\("input"/, "缺少 document 级 input 委托");
  assert.match(hubSource, /event\.target\?\.id !== "search-input"/, "input 委托未限定搜索框");
});
