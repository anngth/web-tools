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
});
