import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { validateOpenApi } from "../scripts/check-openapi.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SPEC_PATH = path.join(ROOT, "docs", "openapi.json");

test("OpenAPI 定义结构完整，路径参数与实现一致", () => {
  const { problems, paths, refs } = validateOpenApi();
  assert.deepEqual(problems, [], `OpenAPI 存在问题：\n${problems.join("\n")}`);
  assert.equal(paths, 7, "应当声明 7 个接口路径");
  assert.ok(refs >= 20, `内部引用数量异常：${refs}`);
});

test("OpenAPI 可作为合法 JSON 被 Apifox 导入", () => {
  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, "utf8"));
  assert.match(spec.openapi, /^3\.1\./);
  assert.ok(spec.info?.title, "缺少 info.title");
  assert.ok(Array.isArray(spec.servers) && spec.servers.length > 0, "缺少 servers");
  assert.ok(spec.components?.securitySchemes?.adminToken, "缺少管理令牌的 securityScheme");
});

test("详情接口把 {id} 声明为路径参数，避免被误当成字面量", () => {
  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, "utf8"));
  const detail = spec.paths["/api/schemes/{id}"].get;
  assert.ok(detail, "缺少 /api/schemes/{id}");
  const pathParams = detail.parameters
    .map((parameter) => (parameter.$ref ? spec.components.parameters[parameter.$ref.split("/").pop()] : parameter))
    .filter((parameter) => parameter?.in === "path");
  assert.equal(pathParams.length, 1);
  assert.equal(pathParams[0].name, "id");
  assert.equal(pathParams[0].required, true);
  assert.ok(pathParams[0].example, "路径参数应当给出示例值，便于在 Apifox 里直接调试");
  assert.ok(!pathParams[0].example.includes("{"), "示例值不能带花括号");
});
