import type { ShortLinkRecord } from "../url-shortener.model";
import type { ShortLinkStore } from "./short-link-backend";

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

export class D1ShortLinkStore implements ShortLinkStore {
  constructor(private readonly database: D1Database) {}

  async findBySlug(slug: string): Promise<ShortLinkRecord | null> {
    const row = await this.database
      .prepare(`
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
      `)
      .bind(slug)
      .first<ShortLinkRow>();

    return row ? toRecord(row) : null;
  }

  async insert(record: ShortLinkRecord): Promise<boolean> {
    const result = await this.database
      .prepare(`
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
        `)
      .bind(
        record.id,
        record.slug,
        record.destinationUrl,
        record.createdAt,
        record.expiresAt,
        record.clickCount,
        record.lastClickedAt,
      )
      .run();
    return result.meta.changes > 0;
  }

  async incrementClicksIfActive(
    recordId: string,
    slug: string,
    clickedAt: string,
  ): Promise<boolean> {
    const result = await this.database
      .prepare(`
        UPDATE short_links
        SET click_count = click_count + 1, last_clicked_at = ?
        WHERE id = ? AND slug = ? AND expires_at > ?
      `)
      .bind(clickedAt, recordId, slug, clickedAt)
      .run();

    return result.meta.changes > 0;
  }

  async deleteExpired(now: string): Promise<number> {
    const result = await this.database
      .prepare("DELETE FROM short_links WHERE expires_at <= ?")
      .bind(now)
      .run();

    return result.meta.changes;
  }
}
