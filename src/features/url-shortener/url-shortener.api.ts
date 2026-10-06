import type {
  CreatedShortLink,
  CreateShortLinkInput,
  ShortLinkStats,
} from "../../shared/short-links/model.ts";

export type UrlShortenerApiErrorCode =
  | "invalid_request"
  | "not_found"
  | "alias_collision"
  | "rate_limited"
  | "internal_error"
  | "service_unavailable"
  | "invalid_response"
  | "network_error";

const ERROR_BY_STATUS: Record<
  number,
  { code: UrlShortenerApiErrorCode; message: string }
> = {
  400: {
    code: "invalid_request",
    message: "Check the destination URL and custom alias, then try again.",
  },
  404: {
    code: "not_found",
    message: "This short link is missing or has expired.",
  },
  409: {
    code: "alias_collision",
    message: "That custom alias is already in use. Choose another alias.",
  },
  413: {
    code: "invalid_request",
    message:
      "The request is too large. Shorten the destination URL or alias, then try again.",
  },
  429: {
    code: "rate_limited",
    message: "Too many links were created from your connection. Wait a while, then try again.",
  },
  500: {
    code: "internal_error",
    message: "The short-link service could not complete the request. Try again.",
  },
  503: {
    code: "service_unavailable",
    message: "The short-link service is temporarily unavailable. Try again.",
  },
};

const INVALID_RESPONSE = {
  code: "invalid_response" as const,
  message: "The short-link service returned an invalid response. Try again.",
};

export class UrlShortenerApiError extends Error {
  readonly code: UrlShortenerApiErrorCode;
  readonly status: number;

  constructor(code: UrlShortenerApiErrorCode, message: string, status = 0) {
    super(message);
    this.name = "UrlShortenerApiError";
    this.code = code;
    this.status = status;
  }
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && keys.every((key) => key in value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const STATS_KEYS = [
  "slug",
  "destinationUrl",
  "createdAt",
  "expiresAt",
  "clickCount",
  "lastClickedAt",
] as const;

const CREATED_LINK_KEYS = [...STATS_KEYS, "shortUrl"] as const;

export function isShortLinkStats(value: unknown): value is ShortLinkStats {
  if (!isRecord(value) || !hasExactKeys(value, STATS_KEYS)) return false;
  return (
    typeof value.slug === "string" &&
    value.slug.length > 0 &&
    isHttpUrl(value.destinationUrl) &&
    isIsoDate(value.createdAt) &&
    isIsoDate(value.expiresAt) &&
    Number.isInteger(value.clickCount) &&
    (value.clickCount as number) >= 0 &&
    (value.lastClickedAt === null || isIsoDate(value.lastClickedAt))
  );
}

export function isCreatedShortLink(value: unknown): value is CreatedShortLink {
  if (!isRecord(value) || !hasExactKeys(value, CREATED_LINK_KEYS)) return false;
  const { shortUrl: _shortUrl, ...stats } = value;
  return isShortLinkStats(stats) && isHttpUrl(value.shortUrl);
}

async function readSuccess<T>(
  response: Response,
  validate: (value: unknown) => value is T,
): Promise<T> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new UrlShortenerApiError(
      INVALID_RESPONSE.code,
      INVALID_RESPONSE.message,
      response.status,
    );
  }
  if (!validate(body)) {
    throw new UrlShortenerApiError(
      INVALID_RESPONSE.code,
      INVALID_RESPONSE.message,
      response.status,
    );
  }
  return body;
}

function responseError(status: number): UrlShortenerApiError {
  const mapped = ERROR_BY_STATUS[status] ?? ERROR_BY_STATUS[500];
  return new UrlShortenerApiError(mapped.code, mapped.message, status);
}

async function request<T>(
  input: string,
  init: RequestInit,
  expectedStatus: number,
  validate: (value: unknown) => value is T,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch {
    throw new UrlShortenerApiError(
      "network_error",
      "Could not reach the short-link service. Check your connection and try again.",
    );
  }
  if (!response.ok) throw responseError(response.status);
  if (response.status !== expectedStatus) {
    throw new UrlShortenerApiError(
      INVALID_RESPONSE.code,
      INVALID_RESPONSE.message,
      response.status,
    );
  }
  return readSuccess(response, validate);
}

export function createShortLink(
  input: CreateShortLinkInput,
): Promise<CreatedShortLink> {
  const body: CreateShortLinkInput = { destinationUrl: input.destinationUrl };
  if (input.customAlias) body.customAlias = input.customAlias;

  return request(
    "/api/links",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    201,
    isCreatedShortLink,
  );
}

export function getShortLinkStats(slug: string): Promise<ShortLinkStats> {
  return request(
    `/api/links/${encodeURIComponent(slug)}/stats`,
    { headers: { accept: "application/json" } },
    200,
    isShortLinkStats,
  );
}
