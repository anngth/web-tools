import type { Context, Hono } from "hono";
import type { StatusCode } from "hono/utils/http-status";
import { renderIndexHtml, renderSiteOrigin } from "../../server/http/index-html";
import {
  parseMaxActiveLinks,
  parseRateLimitRules,
  type MaxActiveLinksEnvironment,
  type RateLimitEnvironment,
} from "../../server/http/limits-config";
import type { AppLogger } from "../../server/http/logger";
import {
  createPublicRoutes,
  publicError,
  validatePublicOrigin,
  type AppBindings,
} from "../../server/http/public-routes";
import { LocalShortLinkBackend } from "../../shared/short-links/local-backend.ts";
import { validateTtlSeconds } from "../../shared/short-links/validation.ts";
import { D1ShortLinkStore } from "../short-links/d1-store";
import { createD1RateLimiter } from "./d1-rate-limiter";

export interface PublicWorkerEnv
  extends RateLimitEnvironment,
    MaxActiveLinksEnvironment {
  DB: D1Database;
  ASSETS: Fetcher;
  PUBLIC_BASE_URL?: string;
  URL_SHORTENER_TTL_SECONDS?: string;
}

function cloudflareClientKey(context: Context): string {
  const address = context.req.header("cf-connecting-ip")?.trim();
  if (address === undefined || address === "") {
    throw new Error("CF-Connecting-IP is unavailable");
  }
  return address;
}

function cacheControlFor(path: string): string {
  if (path === "/" || path.endsWith("/") || path.endsWith("/index.html")) {
    return "no-store";
  }
  if (/-[a-zA-Z0-9_-]{8}\.[^/\\]+$/.test(path)) {
    return "public, max-age=31536000, immutable";
  }
  return "no-cache";
}

/**
 * Worker counterpart of `server/http/public-app.ts`: same API routes, with
 * links in D1 and static files from the Workers assets binding. Files that
 * carry `__SITE_ORIGIN__` are rewritten here, as the Node server does.
 */
export function createWorkerPublicApp(
  env: PublicWorkerEnv,
  options: { logger: AppLogger; now?: () => Date },
): Hono<AppBindings> {
  const ttlSeconds = validateTtlSeconds(env.URL_SHORTENER_TTL_SECONDS?.trim());
  const backend = new LocalShortLinkBackend(
    new D1ShortLinkStore(env.DB),
    ttlSeconds,
    parseMaxActiveLinks(env),
  );
  const now = options.now;
  const limiter = createD1RateLimiter({
    database: env.DB,
    rules: parseRateLimitRules(env),
    now: now === undefined ? undefined : () => now().getTime(),
  });
  const configuredOrigin = validatePublicOrigin(env.PUBLIC_BASE_URL);
  const app = createPublicRoutes({
    backend,
    publicBaseUrl: env.PUBLIC_BASE_URL,
    getClientKey: cloudflareClientKey,
    limiter,
    logger: options.logger,
    now,
  });

  const originOf = (context: Context): string =>
    configuredOrigin ?? new URL(context.req.url).origin;
  const fetchAsset = (context: Context, path: string): Promise<Response> =>
    env.ASSETS.fetch(new URL(path, context.req.url));

  const serveTemplate =
    (file: string, contentType: string) => async (context: Context) => {
      const asset = await fetchAsset(context, file);
      if (!asset.ok) return publicError(context, 404, "not_found");
      return context.body(renderSiteOrigin(await asset.text(), originOf(context)), 200, {
        "Content-Type": contentType,
        "Cache-Control": "no-cache",
      });
    };

  app.get("/robots.txt", serveTemplate("/robots.txt", "text/plain; charset=utf-8"));
  app.get(
    "/sitemap.xml",
    serveTemplate("/sitemap.xml", "application/xml; charset=utf-8"),
  );

  // The assets binding answers unknown paths with index.html
  // (not_found_handling = "single-page-application" in wrangler.toml).
  app.get("*", async (context) => {
    const asset = await env.ASSETS.fetch(context.req.raw);
    const contentType = asset.headers.get("content-type") ?? "";
    if (asset.ok && contentType.startsWith("text/html")) {
      const html = renderIndexHtml(
        await asset.text(),
        originOf(context),
        context.req.path,
      );
      return context.body(html, 200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
    }

    const headers = new Headers(asset.headers);
    if (asset.ok) headers.set("Cache-Control", cacheControlFor(context.req.path));
    return context.newResponse(
      asset.body,
      asset.status as StatusCode,
      Object.fromEntries(headers),
    );
  });

  app.notFound((context) => publicError(context, 404, "not_found"));
  return app;
}
