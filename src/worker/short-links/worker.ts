import { Hono } from "hono";
import {
  ShortLinkError,
  isShortLinkError,
  type CreateShortLinkInput,
} from "../../shared/short-links/model.ts";
import { validateTtlSeconds } from "../../shared/short-links/validation.ts";
import { D1ShortLinkStore } from "./d1-store";
import { LocalShortLinkBackend } from "../../shared/short-links/local-backend.ts";
import {
  RequestBodyTooLargeError,
  readLimitedRequestBody,
} from "../../features/url-shortener/backend/read-limited-body";

const MAX_BODY_BYTES = 16 * 1024;

interface WorkerEnv {
  DB: D1Database;
  GATEWAY_TOKEN?: string;
}

interface CreatePayload {
  input: CreateShortLinkInput;
  now: string;
  ttlSeconds: number;
  maxActiveLinks?: number;
}

function jsonError(error: string) {
  return { error };
}

function invalidRequest(): never {
  throw new ShortLinkError("validation");
}

function constantTimeEqual(expected: string, actual: string): boolean {
  const encoder = new TextEncoder();
  const expectedBytes = encoder.encode(expected);
  const actualBytes = encoder.encode(actual);
  let difference = expectedBytes.length ^ actualBytes.length;

  for (let index = 0; index < expectedBytes.length; index += 1) {
    difference |= expectedBytes[index] ^ (actualBytes[index] ?? 0);
  }

  return difference === 0;
}

function parseCanonicalIso(value: unknown): Date {
  if (typeof value !== "string") invalidRequest();

  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    invalidRequest();
  }

  return parsed;
}

async function parseJsonBody(request: Request): Promise<unknown> {
  let bytes: Uint8Array;
  try {
    bytes = await readLimitedRequestBody(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) invalidRequest();
    throw error;
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return invalidRequest();
  }
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalidRequest();
  }
  return value as Record<string, unknown>;
}

function parseCreatePayload(value: unknown): CreatePayload {
  const body = asObject(value);
  const ttlSeconds = body.ttlSeconds;
  if (typeof ttlSeconds !== "number" || !Number.isSafeInteger(ttlSeconds)) {
    invalidRequest();
  }

  validateTtlSeconds(String(ttlSeconds));
  const input = asObject(body.input);

  const maxActiveLinks = body.maxActiveLinks;
  if (
    maxActiveLinks !== undefined &&
    (typeof maxActiveLinks !== "number" ||
      !Number.isSafeInteger(maxActiveLinks) ||
      maxActiveLinks < 1)
  ) {
    invalidRequest();
  }

  return {
    input: input as unknown as CreateShortLinkInput,
    now: parseCanonicalIso(body.now).toISOString(),
    ttlSeconds,
    ...(maxActiveLinks === undefined ? {} : { maxActiveLinks }),
  };
}

function parseQueryNow(request: Request): Date {
  const values = new URL(request.url).searchParams.getAll("now");
  if (values.length !== 1) invalidRequest();
  return parseCanonicalIso(values[0]);
}

const app = new Hono<{ Bindings: WorkerEnv }>();

app.use("*", async (context, next) => {
  const secret = context.env.GATEWAY_TOKEN;
  if (typeof secret !== "string" || secret.length === 0) {
    return context.json(jsonError("internal_error"), 500);
  }

  const authorization = context.req.header("authorization") ?? "";
  const suppliedToken = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  if (!constantTimeEqual(secret, suppliedToken)) {
    return context.json(jsonError("unauthorized"), 401);
  }

  await next();
});

app.get("/internal/health", async (context) => {
  const row = await context.env.DB.prepare("SELECT 1 AS ok").first();
  if (!row) return context.json(jsonError("internal_error"), 500);
  return context.json({ ok: true });
});

app.post("/internal/links", async (context) => {
  const payload = parseCreatePayload(await parseJsonBody(context.req.raw));
  const backend = new LocalShortLinkBackend(
    new D1ShortLinkStore(context.env.DB),
    payload.ttlSeconds,
    payload.maxActiveLinks,
  );
  const created = await backend.create(payload.input, new Date(payload.now));
  return context.json(created, 201);
});

app.get("/internal/links/:slug/stats", async (context) => {
  const now = parseQueryNow(context.req.raw);
  const backend = new LocalShortLinkBackend(
    new D1ShortLinkStore(context.env.DB),
    1,
  );
  const stats = await backend.stats(context.req.param("slug"), now);
  return stats
    ? context.json(stats, 200)
    : context.json(jsonError("not_found"), 404);
});

app.get("/internal/links/:slug/resolve", async (context) => {
  const now = parseQueryNow(context.req.raw);
  const backend = new LocalShortLinkBackend(
    new D1ShortLinkStore(context.env.DB),
    1,
  );
  return context.json(await backend.resolve(context.req.param("slug"), now), 200);
});

app.post("/internal/cleanup", async (context) => {
  const body = asObject(await parseJsonBody(context.req.raw));
  const now = parseCanonicalIso(body.now);
  const backend = new LocalShortLinkBackend(
    new D1ShortLinkStore(context.env.DB),
    1,
  );
  return context.json({ deletedCount: await backend.deleteExpired(now) }, 200);
});

app.onError((error, context) => {
  if (isShortLinkError(error, "validation")) {
    return context.json(jsonError("invalid_request"), 400);
  }
  if (isShortLinkError(error, "alias_collision")) {
    return context.json(jsonError("alias_collision"), 409);
  }
  if (isShortLinkError(error, "capacity")) {
    return context.json(jsonError("capacity_reached"), 507);
  }
  return context.json(jsonError("internal_error"), 500);
});

export default app;
