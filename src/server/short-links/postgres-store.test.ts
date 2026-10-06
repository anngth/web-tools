import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { describeShortLinkStoreContract } from "../../shared/short-links/store-contract.ts";
import { PostgresShortLinkStore } from "./postgres-store";

const databaseUrl = process.env.POSTGRES_TEST_URL?.trim();

if (process.env.CI === "true" && !databaseUrl) {
  throw new Error("POSTGRES_TEST_URL is required when CI=true");
}

describe.skipIf(!databaseUrl)("PostgresShortLinkStore", () => {
  it("creates short_links and idx_short_links_expires_at", async () => {
    const store = await PostgresShortLinkStore.open(
      databaseUrl!.replace(/^postgres:/, "postgresql:"),
    );
    await store.close();
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    const tables = await client.query(
      "SELECT to_regclass('public.short_links') AS table_name",
    );
    const indexes = await client.query(
      "SELECT indexname FROM pg_indexes WHERE indexname = 'idx_short_links_expires_at'",
    );
    await client.end();
    expect(tables.rows[0]?.table_name).toBe("short_links");
    expect(indexes.rows).toHaveLength(1);
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
