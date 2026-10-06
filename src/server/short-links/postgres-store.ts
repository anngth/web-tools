import { Pool } from "pg";
import type { ShortLinkRecord } from "../../shared/short-links/model.ts";
import type { ShortLinkStore } from "../../shared/short-links/short-link-backend.ts";
import { SHORT_LINK_SCHEMA } from "../../shared/short-links/schema.ts";

const INVALID_CONFIGURATION = "Invalid short link backend configuration";

interface ShortLinkRow {
  id: string;
  slug: string;
  destination_url: string;
  created_at: string;
  expires_at: string;
  click_count: number | string;
  last_clicked_at: string | null;
}

function toRecord(row: ShortLinkRow): ShortLinkRecord {
  return {
    id: row.id,
    slug: row.slug,
    destinationUrl: row.destination_url,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    clickCount: Number(row.click_count),
    lastClickedAt: row.last_clicked_at,
  };
}

function assertPostgresUrl(databaseUrl: string): void {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error(INVALID_CONFIGURATION);
  }

  const supportedProtocol =
    url.protocol === "postgres:" || url.protocol === "postgresql:";
  if (!supportedProtocol || url.hostname.length === 0) {
    throw new Error(INVALID_CONFIGURATION);
  }
}

export class PostgresShortLinkStore implements ShortLinkStore {
  private ended = false;

  private constructor(private readonly pool: Pool) {}

  static async open(databaseUrl: string): Promise<PostgresShortLinkStore> {
    assertPostgresUrl(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl, max: 10 });
    pool.on("error", () => undefined);
    try {
      await pool.query(SHORT_LINK_SCHEMA);
    } catch (error) {
      await pool.end().catch(() => undefined);
      throw error;
    }
    return new PostgresShortLinkStore(pool);
  }

  async close(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    await this.pool.end();
  }

  async findBySlug(slug: string): Promise<ShortLinkRecord | null> {
    const result = await this.pool.query<ShortLinkRow>(
      `
      SELECT
        id,
        slug,
        destination_url,
        created_at,
        expires_at,
        click_count,
        last_clicked_at
      FROM short_links
      WHERE slug = $1
      `,
      [slug],
    );
    const row = result.rows[0];
    return row ? toRecord(row) : null;
  }

  async insert(record: ShortLinkRecord): Promise<boolean> {
    const result = await this.pool.query(
      `
      INSERT INTO short_links (
        id,
        slug,
        destination_url,
        created_at,
        expires_at,
        click_count,
        last_clicked_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (slug) DO NOTHING
      `,
      [
        record.id,
        record.slug,
        record.destinationUrl,
        record.createdAt,
        record.expiresAt,
        record.clickCount,
        record.lastClickedAt,
      ],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async incrementClicksIfActive(
    recordId: string,
    slug: string,
    clickedAt: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `
      UPDATE short_links
      SET click_count = click_count + 1, last_clicked_at = $1
      WHERE id = $2 AND slug = $3 AND expires_at > $4
      `,
      [clickedAt, recordId, slug, clickedAt],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async deleteExpired(now: string): Promise<number> {
    const result = await this.pool.query(
      "DELETE FROM short_links WHERE expires_at <= $1",
      [now],
    );
    return result.rowCount ?? 0;
  }

  async countActive(now: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      "SELECT COUNT(*) AS count FROM short_links WHERE expires_at > $1",
      [now],
    );
    return Number(result.rows[0]?.count ?? 0);
  }
}
