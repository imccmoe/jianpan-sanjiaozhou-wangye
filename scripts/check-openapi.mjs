#!/usr/bin/env node
// 校验 docs/openapi.json 的结构完整性与内部引用，并核对接口路径与后端实现一致。
//
// 用法：node scripts/check-openapi.mjs
// 测试直接导入 validateOpenApi()，因此这里把结果与进程退出分开。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SPEC_PATH = path.join(ROOT, "docs", "openapi.json");

// 声明的接口 -> 实际实现文件
const EXPECTED_ROUTES = [
  ["/api/meta", "get", "functions/api/meta.js"],
  ["/api/schemes", "get", "functions/api/schemes/index.js"],
  ["/api/schemes/{id}", "get", "functions/api/schemes/[id].js"],
  ["/api/schemes/submit", "post", "functions/api/schemes/submit.js"],
  ["/api/schemes/feedback", "post", "functions/api/schemes/feedback.js"],
  ["/api/admin/schemes", "get", "functions/api/admin/schemes.js"],
  ["/api/admin/review", "post", "functions/api/admin/review.js"]
];

// 各实现会显式返回的状态码（500 是兜底，允许文档省略）
const IMPLEMENTED_STATUS = {
  "functions/api/meta.js": [200, 500],
  "functions/api/schemes/index.js": [200],
  "functions/api/schemes/[id].js": [200, 400, 404, 500],
  "functions/api/schemes/submit.js": [201, 400, 409, 413, 429, 500],
  "functions/api/schemes/feedback.js": [201, 400, 404, 409, 413, 500],
  "functions/api/admin/schemes.js": [200, 401, 503, 500],
  "functions/api/admin/review.js": [200, 400, 401, 404, 409, 500, 503]
};

/**
 * @returns {{ problems: string[], paths: number, refs: number }}
 */
export function validateOpenApi() {
  const problems = [];
  if (!fs.existsSync(SPEC_PATH)) return { problems: [`缺少 ${path.relative(ROOT, SPEC_PATH)}`], paths: 0, refs: 0 };
  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, "utf8"));

  const resolveRef = (ref) => {
    if (!ref.startsWith("#/")) return null;
    let node = spec;
    for (const segment of ref.slice(2).split("/")) {
      node = node?.[segment];
      if (node === undefined) return null;
    }
    return node;
  };

  const walk = (node, visit) => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item, visit);
      return;
    }
    if (node && typeof node === "object") {
      visit(node);
      for (const value of Object.values(node)) walk(value, visit);
    }
  };

  // 1) 所有 $ref 可解析
  let refs = 0;
  walk(spec, (node) => {
    if (typeof node.$ref === "string") {
      refs += 1;
      if (!resolveRef(node.$ref)) problems.push(`无法解析的引用：${node.$ref}`);
    }
  });

  // 2) 路径参数声明与路由模板一致，且每个响应都有描述
  if (!spec.paths || typeof spec.paths !== "object") {
    return { problems: [...problems, "缺少 paths"], paths: 0, refs };
  }
  for (const [route, operations] of Object.entries(spec.paths)) {
    const placeholders = [...route.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
    for (const [method, operation] of Object.entries(operations)) {
      if (typeof operation !== "object" || !operation.responses) {
        problems.push(`${method.toUpperCase()} ${route} 缺少 responses`);
        continue;
      }
      const declared = (operation.parameters || [])
        .map((parameter) => (parameter.$ref ? resolveRef(parameter.$ref) : parameter))
        .filter((parameter) => parameter?.in === "path")
        .map((parameter) => parameter.name);
      for (const name of placeholders) {
        if (!declared.includes(name)) problems.push(`${method.toUpperCase()} ${route} 未声明路径参数 ${name}`);
      }
      for (const name of declared) {
        if (!placeholders.includes(name)) problems.push(`${method.toUpperCase()} ${route} 声明了多余的路径参数 ${name}`);
      }
      for (const [code, response] of Object.entries(operation.responses)) {
        const resolved = response.$ref ? resolveRef(response.$ref) : response;
        if (!resolved?.description) problems.push(`${method.toUpperCase()} ${route} 的 ${code} 响应缺少 description`);
      }
    }
  }

  // 3) 声明的路径与 functions/api 实际路由一一对应
  for (const [route, method, file] of EXPECTED_ROUTES) {
    if (!spec.paths[route]?.[method]) problems.push(`OpenAPI 缺少 ${method.toUpperCase()} ${route}`);
    if (!fs.existsSync(path.join(ROOT, file))) problems.push(`实现文件不存在：${file}`);
  }
  const documented = new Set(
    Object.entries(spec.paths).flatMap(([route, ops]) => Object.keys(ops).map((method) => `${method.toUpperCase()} ${route}`))
  );
  for (const key of documented) {
    if (!EXPECTED_ROUTES.some(([route, method]) => key === `${method.toUpperCase()} ${route}`)) {
      problems.push(`OpenAPI 多出未实现的路由：${key}`);
    }
  }

  // 4) 文档里的响应码与实现里显式返回的状态码一致
  for (const [route, method, file] of EXPECTED_ROUTES) {
    const implemented = IMPLEMENTED_STATUS[file];
    if (!implemented || !spec.paths[route]?.[method]) continue;
    const codes = Object.keys(spec.paths[route][method].responses).map(Number);
    for (const code of implemented) {
      if (code === 500) continue;
      if (!codes.includes(code)) problems.push(`${method.toUpperCase()} ${route} 文档缺少实现会返回的 ${code}`);
    }
    for (const code of codes) {
      if (!implemented.includes(code)) problems.push(`${method.toUpperCase()} ${route} 文档声明了实现不会返回的 ${code}`);
    }
  }

  return { problems, paths: Object.keys(spec.paths).length, refs };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { problems, paths, refs } = validateOpenApi();
  if (problems.length) {
    console.error(`OpenAPI 校验失败，共 ${problems.length} 项：`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log(`OpenAPI 校验通过：${paths} 个路径、${refs} 个内部引用全部可解析，`
    + `路径参数与 ${EXPECTED_ROUTES.length} 个 Functions 实现一致。`);
}
