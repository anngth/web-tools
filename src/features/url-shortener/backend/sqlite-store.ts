import Database from "better-sqlite3";
import type { ShortLinkRecord } from "../../../shared/short-links/model.ts";
import type { ShortLinkStore } from "../../../shared/short-links/short-link-backend.ts";
import { SHORT_LINK_SCHEMA } from "../../../shared/short-links/schema.ts";

interface ShortLinkRow {
  id: string;
  slug: string;
  destination_url: string;
  created_at: string;
  expires_at: string;
  click_count: number;
  last_clicked_at: string | null;
}

function toRecord(row: ShortLinkRow): ShortLinkRecord {
  return {
    id: row.id,
    slug: row.slug,
    destinationUrl: row.destination_url,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    clickCount: row.click_count,
    lastClickedAt: row.last_clicked_at,
  };
}

export class SqliteShortLinkStore implements ShortLinkStore {
  private readonly findBySlugStatement;
  private readonly insertStatement;
  private readonly incrementClicksIfActiveStatement;
  private readonly deleteExpiredStatement;
  private readonly countActiveStatement;

  private readonly database: Database.Database;

  constructor(path: string) {
    this.database = new Database(path);
    this.database.pragma("busy_timeout = 5000");
    if (path !== ":memory:" && path !== "") {
      this.database.pragma("journal_mode = WAL");
    }
    this.database.exec(SHORT_LINK_SCHEMA);

    this.findBySlugStatement = this.database.prepare<[string], ShortLinkRow>(`
      SELECT
        id,
        slug,
        destination_url,
        created_at,
        expires_at,
        click_count,
        last_clicked_at
      FROM short_links
      WHERE slug = ?
    `);
    this.insertStatement = this.database.prepare(`
      INSERT INTO short_links (
        id,
        slug,
        destination_url,
        created_at,
        expires_at,
        click_count,
        last_clicked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(slug) DO NOTHING
    `);
    this.incrementClicksIfActiveStatement = this.database.prepare(`
      UPDATE short_links
      SET click_count = click_count + 1, last_clicked_at = ?
      WHERE id = ? AND slug = ? AND expires_at > ?
    `);
    this.deleteExpiredStatement = this.database.prepare(`
      DELETE FROM short_links WHERE expires_at <= ?
    `);
    this.countActiveStatement = this.database.prepare<[string], { count: number }>(`
      SELECT COUNT(*) AS count FROM short_links WHERE expires_at > ?
    `);
  }

  async findBySlug(slug: string): Promise<ShortLinkRecord | null> {
    const row = this.findBySlugStatement.get(slug);
    return row ? toRecord(row) : null;
  }

  async insert(record: ShortLinkRecord): Promise<boolean> {
    return this.insertStatement.run(
      record.id,
      record.slug,
      record.destinationUrl,
      record.createdAt,
      record.expiresAt,
      record.clickCount,
      record.lastClickedAt,
    ).changes > 0;
  }

  async incrementClicksIfActive(
    recordId: string,
    slug: string,
    clickedAt: string,
  ): Promise<boolean> {
    return this.incrementClicksIfActiveStatement.run(
      clickedAt,
      recordId,
      slug,
      clickedAt,
    ).changes > 0;
  }

  async deleteExpired(now: string): Promise<number> {
    return Number(this.deleteExpiredStatement.run(now).changes);
  }

  async countActive(now: string): Promise<number> {
    return this.countActiveStatement.get(now)?.count ?? 0;
  }

  close(): void {
    if (this.database.open) this.database.close();
  }
}
