-- 0001_init.sql
-- Coftea Cafe loyalty: batches, one-time codes, cards, stamps, rewards.

CREATE TABLE IF NOT EXISTS batches (
  id         TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS codes (
  code         TEXT PRIMARY KEY,
  batch_id     TEXT NOT NULL,
  used_at      TEXT,
  used_by_card TEXT,
  used_by_slot INTEGER
);
CREATE INDEX IF NOT EXISTS idx_codes_batch ON codes (batch_id, used_at);

CREATE TABLE IF NOT EXISTS cards (
  id           TEXT PRIMARY KEY,
  phone        TEXT,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  cycle        INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_cards_phone ON cards (phone);

CREATE TABLE IF NOT EXISTS stamps (
  card_id    TEXT NOT NULL,
  cycle      INTEGER NOT NULL,
  slot       INTEGER NOT NULL,
  code       TEXT NOT NULL,
  stamped_at TEXT NOT NULL,
  PRIMARY KEY (card_id, cycle, slot)
);

CREATE TABLE IF NOT EXISTS redemptions (
  card_id    TEXT NOT NULL,
  cycle      INTEGER NOT NULL,
  milestone  INTEGER NOT NULL,
  claimed_at TEXT NOT NULL,
  PRIMARY KEY (card_id, cycle, milestone)
);

CREATE TABLE IF NOT EXISTS attempts (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL,
  ip      TEXT,
  ok      INTEGER NOT NULL,
  at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attempts_card ON attempts (card_id, at);
CREATE INDEX IF NOT EXISTS idx_attempts_ip ON attempts (ip, at);
