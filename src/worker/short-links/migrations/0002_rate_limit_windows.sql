CREATE TABLE IF NOT EXISTS rate_limit_windows (
  client_key TEXT NOT NULL,
  window_ms INTEGER NOT NULL,
  reset_at INTEGER NOT NULL,
  count INTEGER NOT NULL CHECK (count >= 1),
  PRIMARY KEY (client_key, window_ms)
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_windows_reset_at
  ON rate_limit_windows(reset_at);
