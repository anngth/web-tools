import { Hono } from "hono";
import {
  ShortLinkError,
  isShortLinkError,
  type CreateShortLinkInput,
} from "../url-shortener.model";
import { validateTtlSeconds } from "../url-shortener.validation";
import { D1ShortLinkStore } from "./d1-store";
import { LocalShortLinkBackend } from "./local-backend";

const MAX_BODY_BYTES = 16 * 1024;

interface WorkerEnv {
  DB: D1Database;
  GATEWAY_TOKEN?: string;
}

interface CreatePayload {
  input: CreateShortLinkInput;
  now: string;
  ttlSeconds: number;
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
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_BODY_BYTES) invalidRequest();

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

  return {
    input: input as unknown as CreateShortLinkInput,
    now: parseCanonicalIso(body.now).toISOString(),
    ttlSeconds,
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

app.post("/internal/links", async (context) => {
  const payload = parseCreatePayload(await parseJsonBody(context.req.raw));
  const backend = new LocalShortLinkBackend(
    new D1ShortLinkStore(context.env.DB),
    payload.ttlSeconds,
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
  return context.json(jsonError("internal_error"), 500);
});

export default app;
