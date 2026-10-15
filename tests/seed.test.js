import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { buildSeed, COLUMNS } from "../scripts/build-d1-seed.mjs";
import { MockD1 } from "./d1-mock.mjs";
import { splitStatements } from "./sql-utils.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const SOURCE = path.join(ROOT, "public", "data", "schemes.json");

test("迁移文件结构正确并覆盖全部业务表", () => {
  const migration = fs.readFileSync(path.join(ROOT, "migrations", "0001_init.sql"), "utf8");
  for (const statement of splitStatements(migration)) {
    assert.match(statement, /^CREATE (TABLE|INDEX) IF NOT EXISTS/i, `非预期语句：${statement.slice(0, 60)}`);
  }
  const tables = [...migration.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((match) => match[1]);
  assert.deepEqual(tables, ["users", "gun_schemes", "scheme_feedback", "audit_logs", "submit_quota"]);
  assert.match(migration, /idx_gun_schemes_status_game/);
  assert.match(migration, /idx_scheme_feedback_dedupe/);
});

test("种子 SQL 可解析入库，行数与源数据一致", { skip: !fs.existsSync(SOURCE) }, async () => {
  const schemes = JSON.parse(fs.readFileSync(SOURCE, "utf8"));
  const { sql, rows } = buildSeed(schemes, { batchSize: 50 });
  assert.equal(rows, schemes.length);

  const statements = splitStatements(sql);
  assert.equal(statements.length, Math.ceil(schemes.length / 50));
  for (const statement of statements) {
    assert.match(statement, /^INSERT OR REPLACE INTO gun_schemes/i);
  }

  const db = new MockD1({ gun_schemes: [] }, { primaryKeys: { gun_schemes: "id" } });
  for (const statement of statements) await db.prepare(statement).run();
  assert.equal(db.tables.gun_schemes.length, schemes.length);

  const byId = new Map(db.tables.gun_schemes.map((row) => [row.id, row]));
  assert.equal(byId.size, schemes.length, "主键必须唯一");

  const first = db.tables.gun_schemes[0];
  assert.equal(first.game, "delta");
  assert.equal(first.status, "active");
  assert.equal(first.source, "orzice-authorized");
  assert.ok(first.weapon_name.length > 0);
  assert.ok(first.gun_code.includes("-"), "分享码应当包含 -");
  assert.ok(first.image.startsWith("https://"), "图片应当是绝对地址");

  const extra = JSON.parse(first.extra_json);
  assert.ok(extra.params && typeof extra.params === "object");
  assert.ok(!JSON.stringify(extra).includes("\"raw\""), "不应把 raw 字段灌进 D1");

  const valorant = db.tables.gun_schemes.filter((row) => row.game === "valorant");
  assert.ok(valorant.length > 0);
  assert.ok(valorant.every((row) => row.mode === "standard"));

  // 生成器输出的列必须与迁移里的建表列对齐。
  const migration = fs.readFileSync(path.join(ROOT, "migrations", "0001_init.sql"), "utf8");
  const tableColumns = /\bgun_schemes \(([^;]+?)\);/s.exec(migration)[1]
    .split("\n")
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((name) => name && !/^(CREATE|PRIMARY|UNIQUE|CHECK|FOREIGN|--)/i.test(name));
  for (const column of COLUMNS) {
    assert.ok(tableColumns.includes(column), `迁移缺少列 ${column}`);
  }
});

test("生成器对缺字段的方案有兜底值并转义引号", () => {
  const { sql, rows } = buildSeed([{ weapon: "O'Brien 的裸方案", code: "裸方案-烽火地带-XXX-1" }], { batchSize: 10 });
  assert.equal(rows, 1);
  const statements = splitStatements(sql);
  assert.equal(statements.length, 1);

  return (async () => {
    const db = new MockD1({ gun_schemes: [] }, { primaryKeys: { gun_schemes: "id" } });
    await db.prepare(statements[0]).run();
    const row = db.tables.gun_schemes[0];
    assert.equal(row.game, "delta");
    assert.equal(row.mode, "operations");
    assert.equal(row.weapon_type, "步枪");
    assert.equal(row.status, "active");
    assert.equal(row.author_name, "");
    assert.equal(row.source_id, null);
    assert.equal(row.weapon_name, "O'Brien 的裸方案", "单引号应被正确转义与还原");
  })();
});

test("重复主键会被显式去重，避免整批 INSERT 失败", () => {
  const { sql, rows } = buildSeed([
    { id: "dup", weapon: "第一把", code: "a-1" },
    { id: "dup", weapon: "第二把", code: "b-2" }
  ], { batchSize: 10 });
  assert.equal(rows, 2);
  return (async () => {
    const db = new MockD1({ gun_schemes: [] }, { primaryKeys: { gun_schemes: "id" } });
    for (const statement of splitStatements(sql)) await db.prepare(statement).run();
    assert.equal(db.tables.gun_schemes.length, 2);
  })();
});
