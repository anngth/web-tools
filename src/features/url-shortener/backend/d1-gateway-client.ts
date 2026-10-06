import {
  ShortLinkError,
  type CreateShortLinkInput,
  type ShortLinkPublic,
  type ShortLinkStats,
} from "../url-shortener.model";
import type { ShortLinkBackend } from "./short-link-backend";

const MAX_GATEWAY_RESPONSE_BYTES = 16 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const JSON_HEADERS = { "content-type": "application/json" } as const;

type JsonRecord = Record<string, unknown>;

class D1GatewayOperationError extends Error {
  constructor() {
    super("D1 gateway operation failed");
    this.name = "D1GatewayOperationError";
  }
}

function gatewayError(): Error {
  return new D1GatewayOperationError();
}

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function hasExactKeys(record: JsonRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isCanonicalIso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function isDotOnlySlug(value: string): boolean {
  return value === "." || value === "..";
}

function parseLink(value: unknown): ShortLinkPublic {
  const record = asRecord(value);
  const keys = [
    "slug",
    "destinationUrl",
    "createdAt",
    "expiresAt",
    "clickCount",
    "lastClickedAt",
  ] as const;
  if (
    !record ||
    !hasExactKeys(record, keys) ||
    typeof record.slug !== "string" ||
    record.slug.length === 0 ||
    typeof record.destinationUrl !== "string" ||
    !isCanonicalIso(record.createdAt) ||
    !isCanonicalIso(record.expiresAt) ||
    typeof record.clickCount !== "number" ||
    !Number.isSafeInteger(record.clickCount) ||
    record.clickCount < 0 ||
    !(record.lastClickedAt === null || isCanonicalIso(record.lastClickedAt))
  ) {
    throw gatewayError();
  }

  return {
    slug: record.slug,
    destinationUrl: record.destinationUrl,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    clickCount: record.clickCount,
    lastClickedAt: record.lastClickedAt,
  };
}

function parseResolve(value: unknown): { status: 302; destinationUrl: string } | { status: 404 } {
  const record = asRecord(value);
  if (record?.status === 404 && hasExactKeys(record, ["status"])) {
    return { status: 404 };
  }
  if (
    record?.status === 302 &&
    hasExactKeys(record, ["status", "destinationUrl"]) &&
    typeof record.destinationUrl === "string"
  ) {
    return { status: 302, destinationUrl: record.destinationUrl };
  }
  throw gatewayError();
}

function parseDeletedCount(value: unknown): number {
  const record = asRecord(value);
  if (
    !record ||
    !hasExactKeys(record, ["deletedCount"]) ||
    typeof record.deletedCount !== "number" ||
    !Number.isSafeInteger(record.deletedCount) ||
    record.deletedCount < 0
  ) {
    throw gatewayError();
  }
  return record.deletedCount;
}

async function readLimitedJson(response: Response): Promise<unknown> {
  if (!response.body) throw gatewayError();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_GATEWAY_RESPONSE_BYTES) {
        await reader.cancel();
        throw gatewayError();
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof D1GatewayOperationError) throw error;
    throw gatewayError();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw gatewayError();
  }
}

function safeBaseUrl(value: string): URL {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.hostname === "" ||
      url.username !== "" ||
      url.password !== ""
    ) {
      throw gatewayError();
    }
    url.search = "";
    url.hash = "";
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    return url;
  } catch {
    throw gatewayError();
  }
}

export class D1GatewayClient implements ShortLinkBackend {
  private readonly baseUrl: URL;
  private readonly token: string;
  private readonly ttlSeconds: number;
  private readonly maxActiveLinks: number | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: {
    baseUrl: string;
    token: string;
    ttlSeconds: number;
    maxActiveLinks?: number;
    fetch?: typeof fetch;
    timeoutMs?: number;
  }) {
    this.baseUrl = safeBaseUrl(options.baseUrl);
    this.token = options.token;
    this.ttlSeconds = options.ttlSeconds;
    this.maxActiveLinks = options.maxActiveLinks;
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async create(input: CreateShortLinkInput, now = new Date()): Promise<ShortLinkPublic> {
    const safeInput: CreateShortLinkInput = { destinationUrl: input.destinationUrl };
    if (input.customAlias !== undefined) safeInput.customAlias = input.customAlias;
    const response = await this.request("internal/links", {
      method: "POST",
      body: JSON.stringify({
        input: safeInput,
        now: now.toISOString(),
        ttlSeconds: this.ttlSeconds,
        ...(this.maxActiveLinks === undefined ? {} : { maxActiveLinks: this.maxActiveLinks }),
      }),
    });
    if (response.status === 409) throw new ShortLinkError("alias_collision");
    if (response.status === 507) throw new ShortLinkError("capacity");
    if (response.status !== 201) throw gatewayError();
    return parseLink(await readLimitedJson(response));
  }

  async resolve(
    slug: string,
    now = new Date(),
  ): Promise<{ status: 302; destinationUrl: string } | { status: 404 }> {
    if (isDotOnlySlug(slug)) return { status: 404 };
    const response = await this.requestWithNow(`internal/links/${encodeURIComponent(slug)}/resolve`, now);
    if (response.status === 404) return { status: 404 };
    if (response.status !== 200) throw gatewayError();
    return parseResolve(await readLimitedJson(response));
  }

  async stats(slug: string, now = new Date()): Promise<ShortLinkStats | null> {
    if (isDotOnlySlug(slug)) return null;
    const response = await this.requestWithNow(`internal/links/${encodeURIComponent(slug)}/stats`, now);
    if (response.status === 404) return null;
    if (response.status !== 200) throw gatewayError();
    return parseLink(await readLimitedJson(response));
  }

  async deleteExpired(now = new Date()): Promise<number> {
    const response = await this.request("internal/cleanup", {
      method: "POST",
      body: JSON.stringify({ now: now.toISOString() }),
    });
    if (response.status !== 200) throw gatewayError();
    return parseDeletedCount(await readLimitedJson(response));
  }

  private requestWithNow(path: string, now: Date): Promise<Response> {
    return this.request(`${path}?now=${encodeURIComponent(now.toISOString())}`, { method: "GET" });
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl.toString()}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${this.token}`,
          ...JSON_HEADERS,
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (response.status === 502 || response.status === 503 || response.status === 504) {
        throw new ShortLinkError("unavailable");
      }
      return response;
    } catch (error) {
      if (error instanceof ShortLinkError) throw error;
      throw new ShortLinkError("unavailable");
    }
  }
}
