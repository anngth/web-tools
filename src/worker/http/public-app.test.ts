import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import type { AppLogger } from "../../server/http/logger";
import { createWorkerPublicApp, type PublicWorkerEnv } from "./public-app";

const NOW = new Date("2026-07-12T00:00:00.000Z");
const INDEX_HTML = `<!doctype html><html><head>
<title>Old</title>
<meta name="description" content="Old" />
<link rel="canonical" href="__SITE_ORIGIN__/totp" />
</head><body></body></html>`;

const assetFiles: Record<string, { body: string; type: string }> = {
  "/index.html": { body: INDEX_HTML, type: "text/html; charset=utf-8" },
  "/robots.txt": { body: "Sitemap: __SITE_ORIGIN__/sitemap.xml", type: "text/plain" },
  "/sitemap.xml": { body: "<loc>__SITE_ORIGIN__/totp</loc>", type: "application/xml" },
  "/assets/app-AbCd1234.js": { body: "console.log(1)", type: "text/javascript" },
};

// Mirrors not_found_handling = "single-page-application": unknown paths get index.html.
const assets = {
  async fetch(input: RequestInfo | URL) {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const file = assetFiles[url.pathname] ?? assetFiles["/index.html"];
    return new Response(file.body, { headers: { "content-type": file.type } });
  },
} as unknown as Fetcher;

function logger(): AppLogger {
  return { info: vi.fn(), error: vi.fn() };
}

function app(overrides: Partial<PublicWorkerEnv> = {}) {
  return createWorkerPublicApp(
    {
      DB: env.DB,
      ASSETS: assets,
      PUBLIC_BASE_URL: "https://tools.example.com",
      RATE_LIMIT_PER_MINUTE: "2",
      ...overrides,
    },
    { logger: logger(), now: () => NOW },
  );
}

function createLink(subject: ReturnType<typeof app>, alias: string, ip = "203.0.113.8") {
  return subject.request("/api/links", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify({ destinationUrl: "https://example.com/docs", customAlias: alias }),
  });
}

describe("Worker public app", () => {
  it("creates, redirects and reports stats from D1", async () => {
    const subject = app();
    const created = await createLink(subject, "docs");
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      slug: "docs",
      shortUrl: "https://tools.example.com/s/docs",
      expiresAt: "2026-08-11T00:00:00.000Z",
    });

    const redirect = await subject.request("/s/docs");
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe("https://example.com/docs");

    const stats = await subject.request("/api/links/docs/stats");
    expect(await stats.json()).toMatchObject({ clickCount: 1 });
  });

  it("rate limits per CF-Connecting-IP through D1", async () => {
    const subject = app();
    expect((await createLink(subject, "one")).status).toBe(201);
    expect((await createLink(subject, "two")).status).toBe(201);

    const limited = await createLink(app(), "three");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect((await createLink(subject, "four", "198.51.100.1")).status).toBe(201);
  });

  it("fails closed without a client address", async () => {
    const response = await app().request("/api/links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ destinationUrl: "https://example.com" }),
    });
    expect(response.status).toBe(500);
  });

  it("renders the SPA shell with the site origin and route SEO", async () => {
    const response = await app().request("/url-shortener");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(html).toContain('href="https://tools.example.com/url-shortener"');
    expect(html).not.toContain("<title>Old</title>");
  });

  it("falls back to the request origin without PUBLIC_BASE_URL", async () => {
    const response = await app({ PUBLIC_BASE_URL: undefined }).request(
      "https://preview.workers.dev/robots.txt",
    );
    expect(await response.text()).toBe(
      "Sitemap: https://preview.workers.dev/sitemap.xml",
    );
  });

  it("serves hashed assets as immutable and unknown paths as the SPA shell", async () => {
    const asset = await app().request("/assets/app-AbCd1234.js");
    expect(asset.status).toBe(200);
    expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(asset.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await asset.text()).toBe("console.log(1)");

    const missing = await app().request("/assets/missing.js");
    expect(missing.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect((await app().request("/api/unknown")).status).toBe(404);
  });

  it("maps domain errors to public status codes", async () => {
    const subject = app();
    expect((await createLink(subject, "taken")).status).toBe(201);

    const collision = await createLink(subject, "taken", "198.51.100.1");
    expect(collision.status).toBe(409);
    expect(await collision.json()).toEqual({ error: "alias_collision" });

    const full = await createLink(app({ MAX_ACTIVE_LINKS: "1" }), "more", "198.51.100.2");
    expect(full.status).toBe(503);
    expect(await full.json()).toEqual({ error: "capacity_reached" });

    expect((await subject.request("/s/missing")).status).toBe(404);
    expect((await subject.request("/api/links/missing/stats")).status).toBe(404);
  });

  it("rejects malformed create requests", async () => {
    // Each attempt counts toward the limit, so every request uses its own client.
    let client = 0;
    const post = (body: string, contentType = "application/json") =>
      app().request("/api/links", {
        method: "POST",
        headers: { "content-type": contentType, "cf-connecting-ip": `192.0.2.${++client}` },
        body,
      });

    expect((await post("{")).status).toBe(400);
    expect((await post('{"destinationUrl":"https://example.com"}', "text/plain")).status).toBe(400);
    expect((await post('{"destinationUrl":"https://example.com","extra":1}')).status).toBe(400);
    expect((await post('{"destinationUrl":"javascript:alert(1)"}')).status).toBe(400);
    expect((await post(JSON.stringify({ destinationUrl: "x".repeat(17_000) }))).status).toBe(413);
  });

  it("stops redirecting once a link expires", async () => {
    expect((await createLink(app({ URL_SHORTENER_TTL_SECONDS: "60" }), "brief")).status).toBe(201);

    const later = createWorkerPublicApp(
      { DB: env.DB, ASSETS: assets },
      { logger: logger(), now: () => new Date(NOW.getTime() + 60_000) },
    );
    expect((await later.request("/s/brief")).status).toBe(404);
  });

  it("rewrites the sitemap and tags every response with a request id", async () => {
    const response = await app().request("/sitemap.xml");
    expect(response.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect(await response.text()).toBe("<loc>https://tools.example.com/totp</loc>");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("refuses invalid configuration", () => {
    expect(() => app({ URL_SHORTENER_TTL_SECONDS: "0" })).toThrow();
    expect(() => app({ PUBLIC_BASE_URL: "https://tools.example.com/path" })).toThrow();
    expect(() =>
      app({ RATE_LIMIT_PER_MINUTE: "0", RATE_LIMIT_PER_HOUR: "0", RATE_LIMIT_PER_DAY: "0" }),
    ).toThrow();
  });
});
