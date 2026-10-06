import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./worker";

const NOW = "2026-07-12T00:05:00.000Z";
const AUTH_HEADERS = {
  authorization: "Bearer test-secret",
  "content-type": "application/json",
};
const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS short_links (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    destination_url TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    click_count INTEGER NOT NULL DEFAULT 0 CHECK (click_count >= 0),
    last_clicked_at TEXT
  )
`;
const CREATE_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_short_links_expires_at
  ON short_links(expires_at)
`;

function jsonRequest(path: string, body: unknown, token = "test-secret") {
  return worker.request(
    path,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
    env,
  );
}

async function create(alias = "docs", now = "2026-07-12T00:00:00.000Z") {
  return jsonRequest("/internal/links", {
    input: {
      destinationUrl: "https://example.com/docs",
      customAlias: alias,
    },
    now,
    ttlSeconds: 300,
  });
}

describe("authenticated D1 Worker gateway", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ["missing", undefined],
    ["incorrect", "Bearer wrong-secret"],
  ])("rejects %s authentication before body parsing or D1 access", async (_name, authorization) => {
    let databaseAccessed = false;
    const inaccessibleDb = new Proxy({} as D1Database, {
      get() {
        databaseAccessed = true;
        throw new Error("database must not be accessed");
      },
    });
    const bindings = {
      DB: inaccessibleDb,
      GATEWAY_TOKEN: "test-secret",
      TEST_MIGRATIONS: env.TEST_MIGRATIONS,
    };

    const response = await worker.request(
      "/internal/cleanup",
      {
        method: "POST",
        headers: authorization ? { authorization } : undefined,
        body: "{ invalid json",
      },
      bindings,
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(databaseAccessed).toBe(false);
  });

  it.each([undefined, ""])(
    "returns a generic 500 for a missing or empty gateway secret before parsing or D1 access",
    async (gatewayToken) => {
      let databaseAccessed = false;
      const inaccessibleDb = new Proxy({} as D1Database, {
        get() {
          databaseAccessed = true;
          throw new Error("database must not be accessed");
        },
      });

      const response = await worker.request(
        "/internal/cleanup",
        {
          method: "POST",
          headers: { authorization: "Bearer test-secret" },
          body: "{ invalid json",
        },
        {
          DB: inaccessibleDb,
          GATEWAY_TOKEN: gatewayToken as string,
          TEST_MIGRATIONS: env.TEST_MIGRATIONS,
        },
      );

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "internal_error" });
      expect(databaseAccessed).toBe(false);
    },
  );

  it("creates a link and reports validation and alias collisions", async () => {
    const created = await create();
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({
      slug: "docs",
      destinationUrl: "https://example.com/docs",
      createdAt: "2026-07-12T00:00:00.000Z",
      expiresAt: NOW,
      clickCount: 0,
      lastClickedAt: null,
    });

    const invalid = await jsonRequest("/internal/links", {
      input: { destinationUrl: "javascript:alert(1)" },
      now: "2026-07-12T00:00:00.000Z",
      ttlSeconds: 300,
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "invalid_request" });

    const collision = await create();
    expect(collision.status).toBe(409);
    expect(await collision.json()).toEqual({ error: "alias_collision" });
  });

  it("enforces the optional active link cap with a 507 capacity response", async () => {
    const createWithCap = (alias: string) =>
      jsonRequest("/internal/links", {
        input: { destinationUrl: "https://example.com/cap", customAlias: alias },
        now: "2026-07-12T00:00:00.000Z",
        ttlSeconds: 300,
        maxActiveLinks: 1,
      });

    expect((await createWithCap("cap-one")).status).toBe(201);

    const rejected = await createWithCap("cap-two");
    expect(rejected.status).toBe(507);
    expect(await rejected.json()).toEqual({ error: "capacity_reached" });

    const afterExpiry = await jsonRequest("/internal/links", {
      input: { destinationUrl: "https://example.com/cap", customAlias: "cap-three" },
      now: "2026-07-12T00:05:00.000Z",
      ttlSeconds: 300,
      maxActiveLinks: 1,
    });
    expect(afterExpiry.status).toBe(201);
  });

  it.each([0, -1, 1.5, "10", null])("validates maxActiveLinks %j", async (maxActiveLinks) => {
    const response = await jsonRequest("/internal/links", {
      input: { destinationUrl: "https://example.com" },
      now: "2026-07-12T00:00:00.000Z",
      ttlSeconds: 300,
      maxActiveLinks,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
  });

  it.each([0, -1, 1.5, "300", null])("validates ttlSeconds using domain rules", async (ttlSeconds) => {
    const response = await jsonRequest("/internal/links", {
      input: { destinationUrl: "https://example.com" },
      now: "2026-07-12T00:00:00.000Z",
      ttlSeconds,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
  });

  it("returns stats, encoded-slug resolution payloads, and exact-boundary expiration", async () => {
    await create("doc-link");
    const beforeBoundary = encodeURIComponent("2026-07-12T00:04:59.999Z");
    const encodedSlug = "%64oc-link";

    const stats = await worker.request(
      `/internal/links/${encodedSlug}/stats?now=${beforeBoundary}`,
      { headers: { authorization: "Bearer test-secret" } },
      env,
    );
    expect(stats.status).toBe(200);
    expect(await stats.json()).toMatchObject({ slug: "doc-link", clickCount: 0 });

    const resolved = await worker.request(
      `/internal/links/${encodedSlug}/resolve?now=${beforeBoundary}`,
      { headers: { authorization: "Bearer test-secret" } },
      env,
    );
    expect(resolved.status).toBe(200);
    expect(await resolved.json()).toEqual({
      status: 302,
      destinationUrl: "https://example.com/docs",
    });

    const expired = await worker.request(
      `/internal/links/${encodedSlug}/resolve?now=${encodeURIComponent(NOW)}`,
      { headers: { authorization: "Bearer test-secret" } },
      env,
    );
    expect(expired.status).toBe(200);
    expect(await expired.json()).toEqual({ status: 404 });

    const missingStats = await worker.request(
      `/internal/links/${encodedSlug}/stats?now=${encodeURIComponent(NOW)}`,
      { headers: { authorization: "Bearer test-secret" } },
      env,
    );
    expect(missingStats.status).toBe(404);
    expect(await missingStats.json()).toEqual({ error: "not_found" });
  });

  it("returns 404 without incrementing a new record that reuses the resolved slug", async () => {
    await create("race-link");
    const replacementId = "replacement-id";
    const racingDb = {
      ...env.DB,
      prepare(query: string) {
        const statement = env.DB.prepare(query);
        if (!query.includes("UPDATE short_links")) return statement;

        return {
          bind(...values: unknown[]) {
            const bound = statement.bind(...values);
            return {
              async run() {
                await env.DB.prepare("DELETE FROM short_links WHERE slug = ?")
                  .bind("race-link")
                  .run();
                await env.DB.prepare(`
                  INSERT INTO short_links (
                    id, slug, destination_url, created_at, expires_at,
                    click_count, last_clicked_at
                  ) VALUES (?, ?, ?, ?, ?, ?, ?)
                `)
                  .bind(
                    replacementId,
                    "race-link",
                    "https://example.com/replacement",
                    "2026-07-12T00:00:01.000Z",
                    NOW,
                    0,
                    null,
                  )
                  .run();
                return bound.run();
              },
            };
          },
        } as unknown as D1PreparedStatement;
      },
    } as D1Database;

    const response = await worker.request(
      `/internal/links/race-link/resolve?now=${encodeURIComponent(
        "2026-07-12T00:04:59.999Z",
      )}`,
      { headers: { authorization: "Bearer test-secret" } },
      { ...env, DB: racingDb },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 404 });
    expect(
      await env.DB.prepare(
        "SELECT id, click_count FROM short_links WHERE slug = ?",
      )
        .bind("race-link")
        .first(),
    ).toEqual({ id: replacementId, click_count: 0 });
  });

  it("deletes expired rows and returns the cleanup count", async () => {
    await create("first");
    await create("second");

    const response = await worker.request(
      "/internal/cleanup",
      {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify({ now: NOW }),
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deletedCount: 2 });
  });

  it.each([
    ["missing", ""],
    ["repeated", `?now=${encodeURIComponent(NOW)}&now=${encodeURIComponent(NOW)}`],
    ["malformed", "?now=not-a-date"],
    ["non-canonical", "?now=2026-07-12T00%3A05%3A00Z"],
  ])("rejects %s query operation times", async (_name, query) => {
    await create();
    const response = await worker.request(
      `/internal/links/docs/stats${query}`,
      { headers: { authorization: "Bearer test-secret" } },
      env,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
  });

  it.each([
    {},
    { now: [NOW] },
    { now: "not-a-date" },
    { now: "2026-07-12T00:05:00Z" },
  ])("rejects invalid body operation times", async (body) => {
    const response = await jsonRequest("/internal/cleanup", body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
  });

  it("accepts exactly 16 KiB and rejects a larger body", async () => {
    const base = {
      input: { destinationUrl: "https://example.com/?padding=" },
      now: "2026-07-12T00:00:00.000Z",
      ttlSeconds: 300,
    };
    const baseJson = JSON.stringify(base);
    const exactBody = baseJson.replace(
      "https://example.com/?padding=",
      `https://example.com/?padding=${"a".repeat(16_384 - baseJson.length)}`,
    );
    expect(new TextEncoder().encode(exactBody)).toHaveLength(16_384);

    const accepted = await worker.request(
      "/internal/links",
      { method: "POST", headers: AUTH_HEADERS, body: exactBody },
      env,
    );
    expect(accepted.status).toBe(201);

    const rejected = await worker.request(
      "/internal/links",
      { method: "POST", headers: AUTH_HEADERS, body: `${exactBody} ` },
      env,
    );
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toEqual({ error: "invalid_request" });
  });

  it("returns a generic response for unknown D1 failures", async () => {
    await env.DB.prepare("DROP TABLE short_links").run();
    try {
      const response = await create();
      expect(response.status).toBe(500);
      const responseBody = await response.text();
      expect(JSON.parse(responseBody)).toEqual({ error: "internal_error" });
      expect(responseBody).not.toContain("D1_ERROR");
    } finally {
      await env.DB.prepare(CREATE_TABLE_SQL).run();
      await env.DB.prepare(CREATE_INDEX_SQL).run();
    }
  });
});
