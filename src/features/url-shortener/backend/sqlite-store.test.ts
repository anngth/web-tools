import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import type { ShortLinkRecord } from "../url-shortener.model";
import { describeShortLinkStoreContract } from "./store-contract";
import { SqliteShortLinkStore } from "./sqlite-store";

type InspectableStore = {
  database: Database.Database;
};

const temporaryDirectories: string[] = [];

function temporaryDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "web-tools-sqlite-"));
  temporaryDirectories.push(directory);
  return join(directory, "short-links.sqlite");
}

function inspect(store: SqliteShortLinkStore): Database.Database {
  return (store as unknown as InspectableStore).database;
}

function record(overrides: Partial<ShortLinkRecord> = {}): ShortLinkRecord {
  return {
    id: "record-id",
    slug: "docs",
    destinationUrl: "https://example.com/docs",
    createdAt: "2026-07-12T00:00:00.000Z",
    expiresAt: "2026-07-12T00:05:00.000Z",
    clickCount: 0,
    lastClickedAt: null,
    ...overrides,
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describeShortLinkStoreContract(
  "SQLite",
  () => new SqliteShortLinkStore(":memory:"),
);

describe("SqliteShortLinkStore", () => {
  it("initializes the table and expiration index from the shared schema", () => {
    const store = new SqliteShortLinkStore(":memory:");

    const objects = inspect(store)
      .prepare(
        "SELECT name, type FROM sqlite_master WHERE name IN (?, ?) ORDER BY name",
      )
      .all("short_links", "idx_short_links_expires_at");

    expect(objects).toEqual([
      { name: "idx_short_links_expires_at", type: "index" },
      { name: "short_links", type: "table" },
    ]);
    store.close();
  });

  it("enables WAL for file databases", () => {
    const store = new SqliteShortLinkStore(temporaryDatabasePath());

    expect(inspect(store).pragma("journal_mode", { simple: true })).toBe("wal");
    store.close();
  });

  it("keeps in-memory databases out of WAL mode", () => {
    const store = new SqliteShortLinkStore(":memory:");

    expect(inspect(store).pragma("journal_mode", { simple: true })).not.toBe(
      "wal",
    );
    store.close();
  });

  it("sets the connection busy timeout to five seconds", () => {
    const store = new SqliteShortLinkStore(":memory:");

    expect(inspect(store).pragma("busy_timeout", { simple: true })).toBe(5000);
    store.close();
  });

  it("makes close idempotent and rejects operations after closing", async () => {
    const store = new SqliteShortLinkStore(":memory:");

    expect(() => store.close()).not.toThrow();
    expect(() => store.close()).not.toThrow();
    await expect(store.findBySlug("docs")).rejects.toThrow();
  });

  it("propagates non-slug unique constraint failures", async () => {
    const store = new SqliteShortLinkStore(":memory:");
    await store.insert(record());

    await expect(
      store.insert(record({ slug: "other-slug" })),
    ).rejects.toMatchObject({ code: "SQLITE_CONSTRAINT_PRIMARYKEY" });
    store.close();
  });

  it("propagates non-unique database constraint failures", async () => {
    const store = new SqliteShortLinkStore(":memory:");

    await expect(
      store.insert(record({ clickCount: -1 })),
    ).rejects.toMatchObject({ code: "SQLITE_CONSTRAINT_CHECK" });
    store.close();
  });
});
