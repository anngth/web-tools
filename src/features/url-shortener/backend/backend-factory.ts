import { validateTtlSeconds } from "../../../shared/short-links/validation.ts";
import { parseMaxActiveLinks, type MaxActiveLinksEnvironment } from "./limits-config";
import { D1GatewayClient } from "../../../server/short-links/d1-gateway-client.ts";
import { LocalShortLinkBackend } from "../../../shared/short-links/local-backend.ts";
import type { ShortLinkBackend } from "../../../shared/short-links/short-link-backend.ts";
import { SqliteShortLinkStore } from "./sqlite-store";

export interface BackendEnvironment extends MaxActiveLinksEnvironment {
  DATABASE_BACKEND?: string;
  SQLITE_PATH?: string;
  D1_GATEWAY_URL?: string;
  D1_GATEWAY_TOKEN?: string;
  URL_SHORTENER_TTL_SECONDS?: string;
}

export interface BackendSelection {
  backend: ShortLinkBackend;
  backendType: "sqlite" | "d1";
  ttlSeconds: number;
  /** Cap on simultaneously active links; `undefined` means unlimited. */
  maxActiveLinks: number | undefined;
}

function trimmed(value: string | undefined): string | undefined {
  return value?.trim();
}

function configurationError(): Error {
  return new Error("Invalid short link backend configuration");
}

function validateGatewayUrl(value: string | undefined): string {
  if (!value) throw configurationError();
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.hostname === "" ||
      url.username !== "" ||
      url.password !== ""
    ) {
      throw configurationError();
    }
    return url.toString();
  } catch {
    throw configurationError();
  }
}

export function createShortLinkBackend(env: BackendEnvironment): BackendSelection {
  const backendType = trimmed(env.DATABASE_BACKEND);
  let ttlSeconds: number;
  try {
    ttlSeconds = validateTtlSeconds(trimmed(env.URL_SHORTENER_TTL_SECONDS));
  } catch {
    throw configurationError();
  }

  const maxActiveLinks = parseMaxActiveLinks(env);

  if (backendType === "sqlite") {
    const path = trimmed(env.SQLITE_PATH);
    if (!path) throw configurationError();
    return {
      backend: new LocalShortLinkBackend(
        new SqliteShortLinkStore(path),
        ttlSeconds,
        maxActiveLinks,
      ),
      backendType,
      ttlSeconds,
      maxActiveLinks,
    };
  }

  if (backendType === "d1") {
    const baseUrl = validateGatewayUrl(trimmed(env.D1_GATEWAY_URL));
    const token = trimmed(env.D1_GATEWAY_TOKEN);
    if (!token) throw configurationError();
    return {
      backend: new D1GatewayClient({
        baseUrl,
        token,
        ttlSeconds,
        maxActiveLinks,
      }),
      backendType,
      ttlSeconds,
      maxActiveLinks,
    };
  }

  throw configurationError();
}
