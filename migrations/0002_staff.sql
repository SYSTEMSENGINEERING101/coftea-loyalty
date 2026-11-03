-- 0002_staff.sql
-- Staff access tokens for /admin. The superadmin token is not stored here;
-- it lives only as a SHA-256 hash inside public/_worker.js (SUPERADMIN_HASH).

CREATE TABLE IF NOT EXISTS staff_tokens (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active',
  created_at   TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_staff_status ON staff_tokens (status);
