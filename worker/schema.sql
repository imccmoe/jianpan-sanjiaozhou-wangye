CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS gun_schemes (
  id TEXT PRIMARY KEY,
  game TEXT NOT NULL,
  weapon_name TEXT NOT NULL,
  weapon_type TEXT NOT NULL,
  value_score INTEGER NOT NULL DEFAULT 0,
  price INTEGER NOT NULL DEFAULT 0,
  usage_count INTEGER NOT NULL DEFAULT 0,
  author_id TEXT,
  gun_code TEXT NOT NULL,
  adapter_config TEXT NOT NULL,
  sensitivity_note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scheme_feedback (
  id TEXT PRIMARY KEY,
  scheme_id TEXT NOT NULL,
  user_id TEXT,
  feedback_type TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  scheme_id TEXT NOT NULL,
  admin_id TEXT,
  action TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
