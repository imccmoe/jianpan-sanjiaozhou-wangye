// D1 访问层与领域规则。所有 SQL 都使用绑定参数，不做字符串拼接。

import { int, safeUrl, schemeCode, text } from "./http.js";

export const GAMES = {
  delta: "三角洲行动",
  valorant: "无畏契约"
};

export const MODES = {
  operations: "烽火地带",
  warfare: "全面战场",
  standard: "标准模式"
};

export const STATUSES = ["active", "pending", "rejected", "hidden"];
export const PUBLIC_STATUSES = ["active"];
export const FEEDBACK_TYPES = ["good", "inaccurate", "weak", "invalid"];
export const SORTS = {
  hot: "usage_count DESC, like_count DESC, created_at DESC",
  new: "created_at DESC",
  value: "value_score DESC, usage_count DESC",
  price: "price DESC, usage_count DESC",
  name: "weapon_name ASC"
};

export function d1(env) {
  const db = env && env.DB;
  if (!db) {
    const error = new Error("D1 binding DB is not configured");
    error.status = 503;
    error.code = "db_unbound";
    throw error;
  }
  return db;
}

function parseJson(value, fallback) {
  if (typeof value !== "string" || !value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/**
 * 把一行 D1 记录转成前端消费的方案对象。
 * 新导入的行把抓取附加字段放在 extra_json；仅当其为空时
 * 才回退读取 adapter_config，因此历史行仍然可用。
 */
export function shapeScheme(row, { detail = false } = {}) {
  if (!row) return null;
  const extra = parseJson(row.extra_json, null) || parseJson(row.adapter_config, {}) || {};
  const scheme = {
    id: row.id,
    game: row.game,
    gameLabel: GAMES[row.game] || row.game,
    mode: row.mode,
    modeLabel: MODES[row.mode] || row.mode,
    weapon: row.weapon_name,
    objectName: row.object_name || row.weapon_name,
    type: row.weapon_type,
    ammo: row.ammo || "",
    map: row.map || "",
    image: row.image || "",
    value: Number(row.value_score) || 0,
    price: Number(row.price) || 0,
    users: Number(row.usage_count) || 0,
    likes: Number(row.like_count) || 0,
    author: row.author_name || "",
    code: row.gun_code,
    status: row.status,
    source: row.source,
    createdAt: row.created_at,
    sensitivity: row.sensitivity_note || ""
  };
  if (detail) {
    scheme.params = extra.params || {};
    scheme.feedback = extra.feedback || {};
    scheme.sourceUrl = extra.sourceUrl || "";
    scheme.rawId = row.source_id || null;
    scheme.updatedAt = row.updated_at;
  }
  return scheme;
}

function buildFilters(url, { includeStatus }) {
  const where = [];
  const params = [];

  const status = text(url.searchParams.get("status"), 20);
  if (includeStatus && status && STATUSES.includes(status)) {
    where.push("status = ?");
    params.push(status);
  } else {
    where.push("status = 'active'");
  }

  const game = text(url.searchParams.get("game"), 24);
  if (game && GAMES[game]) {
    where.push("game = ?");
    params.push(game);
  }

  const mode = text(url.searchParams.get("mode"), 24);
  if (mode && MODES[mode]) {
    where.push("mode = ?");
    params.push(mode);
  }

  const type = text(url.searchParams.get("type"), 40);
  if (type) {
    where.push("weapon_type = ?");
    params.push(type);
  }

  const author = text(url.searchParams.get("author"), 60);
  if (author) {
    where.push("author_name LIKE ? ESCAPE '\\'");
    params.push(`%${likePattern(author)}%`);
  }

  const query = text(url.searchParams.get("q"), 60);
  if (query) {
    // 五个 ? 各占一个绑定槽，:1 之类的复用编号在混合位置参数时容易错位。
    where.push(
      "(weapon_name LIKE ? ESCAPE '\\' OR object_name LIKE ? ESCAPE '\\'" +
      " OR weapon_type LIKE ? ESCAPE '\\' OR author_name LIKE ? ESCAPE '\\'" +
      " OR gun_code LIKE ? ESCAPE '\\')"
    );
    const pattern = `%${likePattern(query)}%`;
    params.push(pattern, pattern, pattern, pattern, pattern);
  }

  const minValue = int(url.searchParams.get("minValue"), 0, { min: 0, max: 100_000_000 });
  if (minValue > 0) {
    where.push("value_score >= ?");
    params.push(minValue);
  }

  return { where, params };
}

/** 转义 LIKE 通配符，避免用户输入 % 或 _ 时扫全表。 */
export function likePattern(value) {
  return String(value).replace(/[\\%_]/g, (match) => `\\${match}`);
}

export function listQuery(url, { includeStatus = false } = {}) {
  const { where, params } = buildFilters(url, { includeStatus });
  const sortKey = text(url.searchParams.get("sort"), 16) || "hot";
  const order = SORTS[sortKey] || SORTS.hot;
  const limit = int(url.searchParams.get("limit"), 24, { min: 1, max: 60 });
  const offset = int(url.searchParams.get("offset"), 0, { min: 0, max: 200_000 });
  return {
    sort: SORTS[sortKey] ? sortKey : "hot",
    limit,
    offset,
    where: where.join(" AND "),
    params,
    order
  };
}

export async function querySchemes(db, options) {
  const { where, params, order, limit, offset } = options;
  const sql =
    `SELECT * FROM gun_schemes WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`;
  const [list, count] = await db.batch([
    db.prepare(sql).bind(...params, limit, offset),
    db.prepare(`SELECT COUNT(*) AS total FROM gun_schemes WHERE ${where}`).bind(...params)
  ]);
  return {
    items: (list.results || []).map((row) => shapeScheme(row)),
    total: Number(count.results?.[0]?.total) || 0
  };
}

export async function getScheme(db, id) {
  const row = await db.prepare("SELECT * FROM gun_schemes WHERE id = ?").bind(id).first();
  return row ? shapeScheme(row, { detail: true }) : null;
}

export async function facets(db, { includeStatus = false } = {}) {
  const statusWhere = includeStatus ? "" : "WHERE status = 'active'";
  const [types, games, modes] = await db.batch([
    db.prepare(
      `SELECT weapon_type AS name, COUNT(*) AS count FROM gun_schemes ${statusWhere}` +
      " GROUP BY weapon_type ORDER BY count DESC"
    ),
    db.prepare(
      `SELECT game AS name, COUNT(*) AS count FROM gun_schemes ${statusWhere} GROUP BY game ORDER BY count DESC`
    ),
    db.prepare(
      `SELECT mode AS name, COUNT(*) AS count FROM gun_schemes ${statusWhere} GROUP BY mode ORDER BY count DESC`
    )
  ]);
  const map = (result, labels) =>
    (result.results || [])
      .filter((row) => row.name)
      .map((row) => ({
        name: row.name,
        label: labels ? labels[row.name] || row.name : row.name,
        count: Number(row.count) || 0
      }));
  return {
    types: map(types),
    games: map(games, GAMES),
    modes: map(modes, MODES)
  };
}

export function normalizeSubmission(body) {
  const errors = [];
  const game = text(body.game, 24) || "delta";
  if (!GAMES[game]) errors.push("game 必须是 delta 或 valorant");
  const mode = text(body.mode, 24) || (game === "valorant" ? "standard" : "operations");
  if (!MODES[mode]) errors.push("mode 取值不受支持");
  const weapon = text(body.weapon, 60);
  if (weapon.length < 2) errors.push("weapon 至少 2 个字符");
  const type = text(body.type, 40) || "步枪";
  const code = schemeCode(body.code);
  if (!code) errors.push("code 必须是带有 - 的方案分享码（4~160 字符）");
  const params = {};
  const source = body.params && typeof body.params === "object" ? body.params : {};
  for (const key of ["control", "stability", "hip", "range", "ads"]) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== "") {
      params[key] = int(source[key], 0, { min: 0, max: 999 });
    }
  }
  for (const key of ["recoil", "interval", "scope", "note"]) {
    const value = text(source[key], 80);
    if (value) params[key] = value;
  }
  return {
    errors,
    value: {
      game,
      mode,
      weapon,
      objectName: text(body.objectName, 60) || weapon,
      type,
      ammo: text(body.ammo, 20),
      map: text(body.map, 30),
      image: safeUrl(body.image),
      price: int(body.price, 0, { min: 0, max: 100_000_000 }),
      valueScore: int(body.value, 0, { min: 0, max: 100_000_000 }),
      sensitivity: text(body.sensitivity, 200),
      author: text(body.author, 40) || "匿名玩家",
      code,
      params
    }
  };
}
