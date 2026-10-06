import { Client, Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { describeShortLinkStoreContract } from "../../shared/short-links/store-contract.ts";
import { PostgresShortLinkStore } from "./postgres-store";

const databaseUrl = process.env.POSTGRES_TEST_URL?.trim();

if (process.env.CI === "true" && !databaseUrl) {
  throw new Error("POSTGRES_TEST_URL is required when CI=true");
}

describe.skipIf(!databaseUrl)("PostgresShortLinkStore", () => {
  it("creates short_links and idx_short_links_expires_at", async () => {
    let store: PostgresShortLinkStore | undefined;
    const client = new Client({ connectionString: databaseUrl });
    try {
      store = await PostgresShortLinkStore.open(
        databaseUrl!.replace(/^postgres:/, "postgresql:"),
      );
      await client.connect();
      const tables = await client.query(
        "SELECT to_regclass('public.short_links') AS table_name",
      );
      const indexes = await client.query(
        "SELECT indexname FROM pg_indexes WHERE indexname = 'idx_short_links_expires_at'",
      );
      expect(tables.rows[0]?.table_name).toBe("short_links");
      expect(indexes.rows).toHaveLength(1);
    } finally {
      await client.end().catch(() => undefined);
      await store?.close();
    }
  });
});

if (databaseUrl) {
  describeShortLinkStoreContract("Postgres", async () => {
    const store = await PostgresShortLinkStore.open(databaseUrl);
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query("DELETE FROM short_links");
    await client.end();
    return store;
  });
}

it("rejects a non-postgres URL before connecting", async () => {
  await expect(PostgresShortLinkStore.open("http://localhost:5432/db")).rejects.toThrow(
    "Invalid short link backend configuration",
  );
});

it("rejects a postgres URL without a host before connecting", async () => {
  await expect(PostgresShortLinkStore.open("postgres:///links")).rejects.toThrow(
    "Invalid short link backend configuration",
  );
});

it("does not reject open or surface a driver message when the pool emits an error", async () => {
  const driverMessage = "password=secret connection terminated";
  const query = vi.spyOn(Pool.prototype, "query").mockImplementation(async function (this: Pool) {
    this.emit("error", new Error(driverMessage));
    return { rows: [], rowCount: 0 } as never;
  });
  const end = vi.spyOn(Pool.prototype, "end").mockResolvedValue();
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

  try {
    const store = await PostgresShortLinkStore.open(
      "postgres://user:secret@127.0.0.1:9/links",
    );
    await store.close();
    expect(consoleError).not.toHaveBeenCalled();
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(driverMessage);
  } finally {
    query.mockRestore();
    end.mockRestore();
    consoleError.mockRestore();
  }
});
