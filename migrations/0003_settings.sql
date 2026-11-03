-- 0003_settings.sql
-- Key/value settings. Currently holds only superadmin_hash (SHA-256 of the
-- superadmin token). A value here overrides SUPERADMIN_HASH in _worker.js,
-- which lets the superadmin rotate the token from the UI without a deploy.

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
