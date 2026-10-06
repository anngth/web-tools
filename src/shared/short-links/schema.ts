export const SHORT_LINK_SCHEMA = `
  CREATE TABLE IF NOT EXISTS short_links (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    destination_url TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    click_count INTEGER NOT NULL DEFAULT 0 CHECK (click_count >= 0),
    last_clicked_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_short_links_expires_at
    ON short_links(expires_at);
`;
