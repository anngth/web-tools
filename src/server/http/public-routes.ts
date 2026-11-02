import { Hono, type Context } from "hono";
import {
  isShortLinkError,
  type CreateShortLinkInput,
} from "../../shared/short-links/model.ts";
import type { AppLogger } from "./logger";
import {
  RequestBodyTooLargeError,
  readLimitedRequestBody,
} from "../../shared/http/read-limited-body.ts";
import type { ShortLinkBackend } from "../../shared/short-links/short-link-backend.ts";

const MAX_JSON_BODY_BYTES = 16 * 1024;
export const CONTENT_SECURITY_POLICY =
  "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'";

export type PublicError =
  | "invalid_request"
  | "not_found"
  | "alias_collision"
  | "rate_limited"
  | "capacity_reached"
  | "service_unavailable"
  | "internal_error";

export type AppBindings = {
  Variables: {
    requestId: string;
  };
};

/** Limiters may be in-process (Node) or backed by storage (Worker D1). */
export interface PublicRateLimiter {
  consume(key: string): RateLimitResult | Promise<RateLimitResult>;
}

interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * Security headers, API routes and health checks shared by the Node server and
 * the Cloudflare Worker. Runtimes add their own static file routes and the
 * final not-found handler.
 */
export function createPublicRoutes(options: {
  backend: ShortLinkBackend;
  publicBaseUrl?: string;
  getClientKey: (context: Context) => string;
  limiter: PublicRateLimiter;
  logger: AppLogger;
  now?: () => Date;
}): Hono<AppBindings> {
  const configuredOrigin = validatePublicOrigin(options.publicBaseUrl);
  const now = options.now ?? (() => new Date());
  const app = new Hono<AppBindings>();

  app.use("*", async (context, next) => {
    const requestId = crypto.randomUUID();
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
    const rateLimit = await options.limiter.consume(options.getClientKey(context));
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
      options.logger.info("link_created", {
        requestId: context.get("requestId"),
      });
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
  app.get("/api/health", (context) => context.json({ status: "ok" }));
  app.all("/api/*", (context) => publicError(context, 404, "not_found"));

  return app;
}

export function validatePublicOrigin(value: string | undefined): string | undefined {
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
  if (isShortLinkError(error, "capacity")) {
    return publicError(context, 503, "capacity_reached");
  }
  if (isShortLinkError(error, "unavailable")) {
    return publicError(context, 503, "service_unavailable");
  }
  throw error;
}

export function publicError(
  context: Context,
  status: 400 | 404 | 409 | 413 | 429 | 500 | 503,
  error: PublicError,
): Response {
  return context.json({ error }, status);
}
