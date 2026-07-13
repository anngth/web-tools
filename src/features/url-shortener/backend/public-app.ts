import { randomUUID } from "node:crypto";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import {
  isShortLinkError,
  type CreateShortLinkInput,
} from "../url-shortener.model";
import type { AppLogger } from "./logger";
import type { FixedWindowLimiter } from "./rate-limiter";
import {
  RequestBodyTooLargeError,
  readLimitedRequestBody,
} from "./read-limited-body";
import type { ShortLinkBackend } from "./short-link-backend";

const MAX_JSON_BODY_BYTES = 16 * 1024;
const CONTENT_SECURITY_POLICY =
  "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'";

type PublicError =
  | "invalid_request"
  | "not_found"
  | "alias_collision"
  | "rate_limited"
  | "service_unavailable"
  | "internal_error";

type AppBindings = {
  Variables: {
    requestId: string;
  };
};

export function createPublicApp(options: {
  backend: ShortLinkBackend;
  publicBaseUrl?: string;
  getClientKey: (context: Context) => string;
  limiter: FixedWindowLimiter;
  logger: AppLogger;
  now?: () => Date;
  staticRoot?: string;
}): Hono<AppBindings> {
  const configuredOrigin = validatePublicOrigin(options.publicBaseUrl);
  if (configuredOrigin === undefined && process.env.NODE_ENV === "production") {
    throw new TypeError("PUBLIC_BASE_URL is required in production");
  }

  const now = options.now ?? (() => new Date());
  const app = new Hono<AppBindings>();

  app.use("*", async (context, next) => {
    const requestId = randomUUID();
    context.set("requestId", requestId);
    context.header("X-Request-Id", requestId);
    context.header("X-Content-Type-Options", "nosniff");
    context.header("Referrer-Policy", "no-referrer");
    context.header("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    await next();
  });

  app.onError((error, context) => {
    options.logger.error("request_failed", {
      requestId: context.get("requestId"),
      reason: "unexpected_error",
    });
    return publicError(context, 500, "internal_error");
  });

  app.post("/api/links", async (context) => {
    const rateLimit = options.limiter.consume(options.getClientKey(context));
    if (!rateLimit.allowed) {
      context.header("Retry-After", String(rateLimit.retryAfterSeconds));
      return publicError(context, 429, "rate_limited");
    }

    const declaredLength = parseContentLength(context.req.header("content-length"));
    if (declaredLength !== undefined && declaredLength > MAX_JSON_BODY_BYTES) {
      return publicError(context, 413, "invalid_request");
    }

    if (!isJsonContentType(context.req.header("content-type"))) {
      return publicError(context, 400, "invalid_request");
    }

    let bytes: Uint8Array;
    try {
      bytes = await readLimitedRequestBody(
        context.req.raw,
        MAX_JSON_BODY_BYTES,
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return publicError(context, 413, "invalid_request");
      }
      throw error;
    }

    const input = parseCreateInput(bytes);
    if (input === undefined) {
      return publicError(context, 400, "invalid_request");
    }

    try {
      const created = await options.backend.create(input, now());
      const publicOrigin = configuredOrigin ?? new URL(context.req.url).origin;
      return context.json(
        {
          slug: created.slug,
          destinationUrl: created.destinationUrl,
          createdAt: created.createdAt,
          expiresAt: created.expiresAt,
          clickCount: created.clickCount,
          lastClickedAt: created.lastClickedAt,
          shortUrl: `${publicOrigin}/s/${encodeURIComponent(created.slug)}`,
        },
        201,
      );
    } catch (error) {
      return mapDomainError(context, error);
    }
  });

  app.get("/api/links/:slug/stats", async (context) => {
    try {
      const result = await options.backend.stats(context.req.param("slug"), now());
      if (result === null) return publicError(context, 404, "not_found");
      return context.json({
        slug: result.slug,
        destinationUrl: result.destinationUrl,
        createdAt: result.createdAt,
        expiresAt: result.expiresAt,
        clickCount: result.clickCount,
        lastClickedAt: result.lastClickedAt,
      });
    } catch (error) {
      return mapDomainError(context, error);
    }
  });

  app.get("/s/:slug", async (context) => {
    try {
      const result = await options.backend.resolve(context.req.param("slug"), now());
      if (result.status === 404) return publicError(context, 404, "not_found");
      return context.redirect(result.destinationUrl, 302);
    } catch (error) {
      return mapDomainError(context, error);
    }
  });

  app.get("/healthz", (context) => context.json({ status: "ok" }));
  app.all("/api/*", (context) => publicError(context, 404, "not_found"));

  if (options.staticRoot !== undefined) {
    const setStaticCacheHeader = (path: string, context: Context): void => {
      if (
        path === "/" ||
        path.endsWith("/") ||
        path.endsWith("/index.html") ||
        path.endsWith("\\index.html")
      ) {
        context.header("Cache-Control", "no-store");
      } else if (/-[a-zA-Z0-9_-]{8}\.[^/\\]+$/.test(path)) {
        context.header("Cache-Control", "public, max-age=31536000, immutable");
      } else {
        context.header("Cache-Control", "no-cache");
      }
    };
    const staticFiles = serveStatic({ root: options.staticRoot });
    const indexFallback = serveStatic({
      root: options.staticRoot,
      path: "index.html",
    });

    app.get("*", async (context, next) => {
      setStaticCacheHeader(context.req.path, context);
      return staticFiles(context, next);
    });
    app.get("*", async (context, next) => {
      context.header("Cache-Control", "no-store");
      return indexFallback(context, next);
    });
  }

  app.notFound((context) => publicError(context, 404, "not_found"));
  return app;
}

function validatePublicOrigin(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("PUBLIC_BASE_URL must be an absolute HTTP(S) origin");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new TypeError("PUBLIC_BASE_URL must be an absolute HTTP(S) origin");
  }
  return url.origin;
}

function isJsonContentType(value: string | undefined): boolean {
  return value?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function parseContentLength(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function parseCreateInput(bytes: Uint8Array): CreateShortLinkInput | undefined {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.some((key) => key !== "destinationUrl" && key !== "customAlias") ||
    typeof record.destinationUrl !== "string" ||
    (record.customAlias !== undefined && typeof record.customAlias !== "string")
  ) {
    return undefined;
  }

  return record.customAlias === undefined
    ? { destinationUrl: record.destinationUrl }
    : {
        destinationUrl: record.destinationUrl,
        customAlias: record.customAlias,
      };
}

function mapDomainError(context: Context, error: unknown): Response {
  if (isShortLinkError(error, "validation")) {
    return publicError(context, 400, "invalid_request");
  }
  if (isShortLinkError(error, "alias_collision")) {
    return publicError(context, 409, "alias_collision");
  }
  if (isShortLinkError(error, "unavailable")) {
    return publicError(context, 503, "service_unavailable");
  }
  throw error;
}

function publicError(
  context: Context,
  status: 400 | 404 | 409 | 413 | 429 | 500 | 503,
  error: PublicError,
): Response {
  return context.json({ error }, status);
}
