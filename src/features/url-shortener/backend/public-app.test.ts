import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShortLinkError, type ShortLinkStats } from "../url-shortener.model";
import type { AppLogger } from "./logger";
import { createPublicApp } from "./public-app";
import { createFixedWindowLimiter } from "./rate-limiter";
import type { ShortLinkBackend } from "./short-link-backend";

const now = new Date("2026-07-12T00:00:00.000Z");
const stats: ShortLinkStats = {
  slug: "my docs/2026",
  destinationUrl: "https://example.com/docs",
  createdAt: "2026-07-12T00:00:00.000Z",
  expiresAt: "2026-08-11T00:00:00.000Z",
  clickCount: 3,
  lastClickedAt: "2026-07-12T01:00:00.000Z",
};

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

function backend(
  overrides: Partial<ShortLinkBackend> = {},
): ShortLinkBackend {
  return {
    create: vi.fn(async () => stats),
    resolve: vi.fn(async () => ({
      status: 302 as const,
      destinationUrl: stats.destinationUrl,
    })),
    stats: vi.fn(async () => stats),
    deleteExpired: vi.fn(async () => 0),
    ...overrides,
  };
}

function logger(): AppLogger {
  return { info: vi.fn(), error: vi.fn() };
}

function limiter() {
  return createFixedWindowLimiter({
    limit: 10,
    windowMs: 60_000,
    maxKeys: 10_000,
    now: () => now.getTime(),
  });
}

function app(options: {
  backend?: ShortLinkBackend;
  logger?: AppLogger;
  publicBaseUrl?: string;
  staticRoot?: string;
}) {
  return createPublicApp({
    backend: options.backend ?? backend(),
    publicBaseUrl: options.publicBaseUrl ?? "https://sho.rt",
    getClientKey: () => "203.0.113.8",
    limiter: limiter(),
    logger: options.logger ?? logger(),
    now: () => now,
    staticRoot: options.staticRoot,
  });
}

async function createStaticRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "public-app-"));
  temporaryRoots.push(root);
  await mkdir(join(root, "assets"));
  await writeFile(
    join(root, "index.html"),
    "<!doctype html><html><body>web tools app</body></html>",
  );
  await writeFile(join(root, "assets", "index-AbC123_x.js"), "export{};");
  await writeFile(
    join(root, "assets", "main-application.js"),
    "export{main:true};",
  );
  await writeFile(join(root, "robots.txt"), "User-agent: *");
  return root;
}

async function expectError(
  response: Response,
  status: number,
  error: string,
): Promise<void> {
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ error });
}

describe("createPublicApp", () => {
  it("returns the exact flat create schema with a configured public origin", async () => {
    const create = vi.fn(async () => stats);
    const application = app({ backend: backend({ create }) });

    const response = await application.request("/api/links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        destinationUrl: stats.destinationUrl,
        customAlias: "my-docs",
      }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      ...stats,
      shortUrl: "https://sho.rt/s/my%20docs%2F2026",
    });
    expect(create).toHaveBeenCalledWith(
      {
        destinationUrl: stats.destinationUrl,
        customAlias: "my-docs",
      },
      now,
    );
  });

  it("uses the request origin outside production when no base URL is configured", async () => {
    const application = createPublicApp({
      backend: backend(),
      getClientKey: () => "client",
      limiter: limiter(),
      logger: logger(),
      now: () => now,
    });

    const response = await application.request("https://dev.example:4173/api/links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ destinationUrl: stats.destinationUrl }),
    });

    expect(await response.json()).toMatchObject({
      shortUrl: "https://dev.example:4173/s/my%20docs%2F2026",
    });
  });

  it.each([
    "ftp://sho.rt",
    "https://user:secret@sho.rt",
    "https://sho.rt/path",
    "https://sho.rt?query=yes",
    "https://sho.rt#fragment",
  ])("rejects an invalid configured public base URL: %s", (publicBaseUrl) => {
    expect(() => app({ publicBaseUrl })).toThrow(TypeError);
  });

  it("returns the exact flat statistics schema and a stable missing response", async () => {
    const existing = app({});
    const log = logger();
    const missing = app({
      logger: log,
      backend: backend({ stats: vi.fn(async () => null) }),
    });

    const response = await existing.request("/api/links/my-docs/stats");
    const notFound = await missing.request("/api/links/missing/stats");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(stats);
    await expectError(notFound, 404, "not_found");
    expect(log.error).not.toHaveBeenCalled();
  });

  it("redirects active links with 302 and returns stable JSON for missing links", async () => {
    const existing = app({});
    const log = logger();
    const missing = app({
      logger: log,
      backend: backend({
        resolve: vi.fn(async () => ({ status: 404 as const })),
      }),
    });

    const response = await existing.request("/s/my-docs", {
      redirect: "manual",
    });
    const notFound = await missing.request("/s/missing");

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(stats.destinationUrl);
    await expectError(notFound, 404, "not_found");
    expect(log.error).not.toHaveBeenCalled();
  });

  it.each([
    ["validation", 400, "invalid_request"],
    ["alias_collision", 409, "alias_collision"],
    ["unavailable", 503, "service_unavailable"],
  ] as const)(
    "maps the typed %s create error to %i",
    async (code, statusCode, publicCode) => {
      const log = logger();
      const application = app({
        logger: log,
        backend: backend({
          create: vi.fn(async () => {
            throw new ShortLinkError(code);
          }),
        }),
      });

      const response = await application.request("/api/links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ destinationUrl: stats.destinationUrl }),
      });

      await expectError(response, statusCode, publicCode);
      expect(log.error).not.toHaveBeenCalled();
    },
  );

  it("maps only typed errors and safely logs an unexpected failure", async () => {
    const log = logger();
    const application = app({
      logger: log,
      backend: backend({
        create: vi.fn(async () => {
          throw new Error("secret destination https://private.example/token");
        }),
      }),
    });

    const response = await application.request("/api/links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ destinationUrl: stats.destinationUrl }),
    });
    const requestId = response.headers.get("X-Request-Id");

    await expectError(response, 500, "internal_error");
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledWith("request_failed", {
      requestId,
      reason: "unexpected_error",
    });
    expect(JSON.stringify(vi.mocked(log.error).mock.calls)).not.toContain(
      "private.example",
    );
  });

  it("rejects unsupported content types and malformed request shapes", async () => {
    const application = app({});
    const text = await application.request("/api/links", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "hello",
    });
    const array = await application.request("/api/links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "[]",
    });

    await expectError(text, 400, "invalid_request");
    await expectError(array, 400, "invalid_request");
  });

  it("consumes the limit before body-size enforcement and JSON parsing", async () => {
    const application = app({});

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await application.request("/api/links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: attempt % 2 === 0 ? "{" : "x".repeat(16 * 1024 + 1),
      });
      expect([400, 413]).toContain(response.status);
      expect(await response.json()).toEqual({ error: "invalid_request" });
    }

    const blocked = await application.request("/api/links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ destinationUrl: stats.destinationUrl }),
    });

    await expectError(blocked, 429, "rate_limited");
    expect(blocked.headers.get("Retry-After")).toMatch(/^\d+$/);
  });

  it("enforces the byte limit for multibyte UTF-8 and consumes that attempt", async () => {
    const application = app({});
    const multibyteBody = JSON.stringify({ destinationUrl: "é".repeat(9_000) });
    expect(multibyteBody.length).toBeLessThan(16 * 1024);
    expect(new TextEncoder().encode(multibyteBody).byteLength).toBeGreaterThan(
      16 * 1024,
    );

    const oversized = await application.request("/api/links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: multibyteBody,
    });
    await expectError(oversized, 413, "invalid_request");

    for (let attempt = 0; attempt < 9; attempt += 1) {
      const response = await application.request("/api/links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      });
      await expectError(response, 400, "invalid_request");
    }

    const blocked = await application.request("/api/links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ destinationUrl: stats.destinationUrl }),
    });
    await expectError(blocked, 429, "rate_limited");
  });

  it("returns 413 to a real chunked Node request before later body chunks are sent", async () => {
    const selectedBackend = backend();
    const application = app({ backend: selectedBackend });
    const server = serve({
      fetch: application.fetch,
      hostname: "127.0.0.1",
      port: 0,
    });

    try {
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("Expected an IPv4 listener address");
      }

      const response = await new Promise<{ status: number; body: string }>(
        (resolve, reject) => {
          const request = httpRequest(
            {
              hostname: "127.0.0.1",
              port: address.port,
              path: "/api/links",
              method: "POST",
              headers: {
                "content-type": "application/json",
                "transfer-encoding": "chunked",
              },
            },
            (incoming) => {
              let body = "";
              incoming.setEncoding("utf8");
              incoming.on("data", (chunk) => {
                body += chunk;
              });
              incoming.on("end", () => {
                resolve({ status: incoming.statusCode ?? 0, body });
              });
            },
          );
          request.on("error", reject);
          request.write(Buffer.alloc(16_384));
          request.write(Buffer.from([1]));
          // Deliberately keep the request open: a bounded reader responds now
          // instead of waiting for or buffering an arbitrary remaining body.
        },
      );

      expect(response).toEqual({
        status: 413,
        body: JSON.stringify({ error: "invalid_request" }),
      });
      expect(selectedBackend.create).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it.each(["validation", "alias_collision"] as const)(
    "counts typed %s failures as creation attempts without error logs",
    async (code) => {
      const log = logger();
      const application = app({
        logger: log,
        backend: backend({
          create: vi.fn(async () => {
            throw new ShortLinkError(code);
          }),
        }),
      });

      for (let attempt = 0; attempt < 10; attempt += 1) {
        const response = await application.request("/api/links", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ destinationUrl: stats.destinationUrl }),
        });
        expect(response.status).toBe(code === "validation" ? 400 : 409);
      }

      const blocked = await application.request("/api/links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ destinationUrl: stats.destinationUrl }),
      });
      await expectError(blocked, 429, "rate_limited");
      expect(log.error).not.toHaveBeenCalled();
    },
  );

  it("sets a fresh request ID and baseline security headers on every response", async () => {
    const application = app({});
    const first = await application.request("/api/missing");
    const second = await application.request("/api/missing");

    expect(first.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.headers.get("X-Request-Id")).not.toBe(
      first.headers.get("X-Request-Id"),
    );
    expect(first.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(first.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(first.headers.get("Content-Security-Policy")).toBe(
      "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
    );
  });

  it("serves static files with immutable hashed assets and no-store HTML", async () => {
    const staticRoot = await createStaticRoot();
    const application = app({ staticRoot });

    const asset = await application.request("/assets/index-AbC123_x.js");
    const semanticAsset = await application.request(
      "/assets/main-application.js",
    );
    const index = await application.request("/index.html");
    const root = await application.request("/");
    const plain = await application.request("/robots.txt");

    expect(asset.status).toBe(200);
    expect(asset.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(await asset.text()).toBe("export{};");
    expect(semanticAsset.status).toBe(200);
    expect(semanticAsset.headers.get("Cache-Control")).toBe("no-cache");
    expect(index.headers.get("Cache-Control")).toBe("no-store");
    expect(root.headers.get("Cache-Control")).toBe("no-store");
    expect(plain.headers.get("Cache-Control")).toBe("no-cache");
  });

  it("fills the site origin placeholder from PUBLIC_BASE_URL", async () => {
    const staticRoot = await createStaticRoot();
    await writeFile(
      join(staticRoot, "index.html"),
      '<link rel="canonical" href="__SITE_ORIGIN__/" /><a href="__SITE_ORIGIN__/x"></a>',
    );
    await writeFile(
      join(staticRoot, "robots.txt"),
      "Sitemap: __SITE_ORIGIN__/sitemap.xml",
    );
    await writeFile(
      join(staticRoot, "sitemap.xml"),
      "<loc>__SITE_ORIGIN__/url-shortener</loc>",
    );
    const application = app({
      staticRoot,
      publicBaseUrl: "https://example.org",
    });

    const index = await application.request("/");
    const spa = await application.request("/url-shortener");
    const robots = await application.request("/robots.txt");
    const sitemap = await application.request("/sitemap.xml");

    expect(await index.text()).toBe(
      '<link rel="canonical" href="https://example.org/totp" /><a href="https://example.org/x"></a>',
    );
    expect(await spa.text()).toContain("https://example.org/x");
    expect(await robots.text()).toBe(
      "Sitemap: https://example.org/sitemap.xml",
    );
    expect(sitemap.headers.get("content-type")).toContain("application/xml");
    expect(await sitemap.text()).toBe(
      "<loc>https://example.org/url-shortener</loc>",
    );
  });

  it("serves per-tool metadata in the HTML for each SPA path", async () => {
    const staticRoot = await createStaticRoot();
    await writeFile(
      join(staticRoot, "index.html"),
      '<title>TOTP Generator | Web Tools</title><link rel="canonical" href="__SITE_ORIGIN__/totp" />',
    );
    const application = app({
      staticRoot,
      publicBaseUrl: "https://example.org",
    });

    const shortener = await (await application.request("/url-shortener")).text();
    const unknown = await (await application.request("/bogus")).text();

    expect(shortener).toContain("<title>URL Shortener | Web Tools</title>");
    expect(shortener).toContain('href="https://example.org/url-shortener"');
    expect(unknown).toContain("<title>TOTP Generator - Free 2FA Codes | Web Tools</title>");
    expect(unknown).toContain('href="https://example.org/totp"');
  });

  it("returns 404 instead of the app shell when robots.txt or sitemap.xml is missing", async () => {
    const staticRoot = await createStaticRoot();
    await rm(join(staticRoot, "robots.txt"));
    const application = app({ staticRoot });

    const robots = await application.request("/robots.txt");
    const sitemap = await application.request("/sitemap.xml");

    expect(robots.status).toBe(404);
    expect(sitemap.status).toBe(404);
    expect(await robots.json()).toEqual({ error: "not_found" });
  });

  it("falls back to index.html for SPA routes but never for API paths", async () => {
    const staticRoot = await createStaticRoot();
    const log = logger();
    const application = app({ staticRoot, logger: log });

    const spa = await application.request("/url-shortener");
    const api = await application.request("/api/unknown");

    expect(spa.status).toBe(200);
    expect(spa.headers.get("content-type")).toContain("text/html");
    expect(spa.headers.get("Cache-Control")).toBe("no-store");
    expect(await spa.text()).toContain("web tools app");
    expect(api.status).toBe(404);
    expect(api.headers.get("content-type")).toContain("application/json");
    expect(await api.json()).toEqual({ error: "not_found" });
    expect(log.error).not.toHaveBeenCalled();
  });

  it("reports application readiness without consulting the backend", async () => {
    const selectedBackend = backend();
    const application = app({ backend: selectedBackend });

    const response = await application.request("/healthz");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(selectedBackend.create).not.toHaveBeenCalled();
    expect(selectedBackend.stats).not.toHaveBeenCalled();
    expect(selectedBackend.resolve).not.toHaveBeenCalled();
  });
});
