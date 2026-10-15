-- wy-zfq-config-hub · Cloudflare D1 schema
-- 应用顺序：0001 建表与索引，0002 视图兼容旧表结构。

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 配装方案主表。
-- 站内自有字段（game/mode/weapon/...）为一级列以便索引与筛选；
-- 抓取端的历史字段（adapter_config/extra_json）保留用于兼容与溯源。
CREATE TABLE IF NOT EXISTS gun_schemes (
  id TEXT PRIMARY KEY,
  game TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'operations',
  weapon_name TEXT NOT NULL,
  object_name TEXT,
  weapon_type TEXT NOT NULL,
  ammo TEXT,
  map TEXT,
  image TEXT,
  value_score INTEGER NOT NULL DEFAULT 0,
  price INTEGER NOT NULL DEFAULT 0,
  usage_count INTEGER NOT NULL DEFAULT 0,
  like_count INTEGER NOT NULL DEFAULT 0,
  author_id TEXT,
  author_name TEXT,
  gun_code TEXT NOT NULL,
  adapter_config TEXT NOT NULL DEFAULT '',
  sensitivity_note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  source TEXT NOT NULL DEFAULT 'user',
  source_id TEXT,
  extra_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gun_schemes_status_game
  ON gun_schemes (status, game, mode);
CREATE INDEX IF NOT EXISTS idx_gun_schemes_type
  ON gun_schemes (status, weapon_type);
CREATE INDEX IF NOT EXISTS idx_gun_schemes_hot
  ON gun_schemes (status, usage_count DESC);
CREATE INDEX IF NOT EXISTS idx_gun_schemes_created
  ON gun_schemes (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gun_schemes_source
  ON gun_schemes (source, source_id);

CREATE TABLE IF NOT EXISTS scheme_feedback (
  id TEXT PRIMARY KEY,
  scheme_id TEXT NOT NULL,
  user_id TEXT,
  feedback_type TEXT NOT NULL,
  note TEXT,
  client_hash TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_scheme_feedback_scheme
  ON scheme_feedback (scheme_id, feedback_type);
CREATE INDEX IF NOT EXISTS idx_scheme_feedback_dedupe
  ON scheme_feedback (scheme_id, client_hash, feedback_type);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  scheme_id TEXT NOT NULL,
  admin_id TEXT,
  action TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_scheme
  ON audit_logs (scheme_id, created_at DESC);

-- 投稿限流：按客户端指纹统计近期投稿量。
CREATE TABLE IF NOT EXISTS submit_quota (
  client_hash TEXT NOT NULL,
  window_start TEXT NOT NULL,
  submit_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (client_hash, window_start)
);
