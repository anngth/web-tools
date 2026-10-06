import { parseMaxActiveLinks, type MaxActiveLinksEnvironment } from "../http/limits-config.ts";
import { LocalShortLinkBackend } from "../../shared/short-links/local-backend.ts";
import type { ShortLinkBackend, ShortLinkStore } from "../../shared/short-links/short-link-backend.ts";
import { validateTtlSeconds } from "../../shared/short-links/validation.ts";
import { StartupFailure, postgresStartupReason } from "../startup-failure.ts";
import { D1GatewayClient } from "./d1-gateway-client.ts";
import { PostgresShortLinkStore } from "./postgres-store.ts";

export interface BackendEnvironment extends MaxActiveLinksEnvironment {
  D1_GATEWAY_URL?: string;
  D1_GATEWAY_TOKEN?: string;
  DATABASE_URL?: string;
  URL_SHORTENER_TTL_SECONDS?: string;
}

export interface BackendSelection {
  backend: ShortLinkBackend;
  backendType: "d1" | "postgres";
  ttlSeconds: number;
  /** Cap on simultaneously active links; `undefined` means unlimited. */
  maxActiveLinks: number | undefined;
}

export interface ShortLinkBackendDependencies {
  probeD1: (target: { baseUrl: string; token: string }) => Promise<boolean>;
  openPostgres: (databaseUrl: string) => Promise<ShortLinkStore>;
}

function configurationError(
  reason: "ttl_invalid" | "max_active_links_invalid" | "database_url_invalid",
): StartupFailure {
  return new StartupFailure(reason);
}

function trimmed(value: string | undefined): string {
  return value?.trim() ?? "";
}

function optionalTrimmed(value: string | undefined): string | undefined {
  return value === undefined ? undefined : value.trim();
}

function gatewayTarget(
  env: BackendEnvironment,
): { baseUrl: string; token: string } | undefined {
  const baseUrl = trimmed(env.D1_GATEWAY_URL);
  const token = trimmed(env.D1_GATEWAY_TOKEN);
  if (baseUrl === "" || token === "") return undefined;

  try {
    const url = new URL(baseUrl);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.hostname === "" ||
      url.username !== "" ||
      url.password !== ""
    ) {
      return undefined;
    }
    return { baseUrl, token };
  } catch {
    return undefined;
  }
}

function requirePostgresUrl(env: BackendEnvironment): string {
  const databaseUrl = trimmed(env.DATABASE_URL);
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw configurationError("database_url_invalid");
  }

  const supportedProtocol = url.protocol === "postgres:" || url.protocol === "postgresql:";
  if (!supportedProtocol || url.hostname === "") {
    throw configurationError("database_url_invalid");
  }
  return databaseUrl;
}

export async function selectShortLinkBackend(
  env: BackendEnvironment,
  dependencies?: ShortLinkBackendDependencies,
): Promise<BackendSelection> {
  let ttlSeconds: number;
  try {
    ttlSeconds = validateTtlSeconds(optionalTrimmed(env.URL_SHORTENER_TTL_SECONDS));
  } catch {
    throw configurationError("ttl_invalid");
  }

  let maxActiveLinks: number | undefined;
  try {
    maxActiveLinks = parseMaxActiveLinks(env);
  } catch {
    throw configurationError("max_active_links_invalid");
  }

  const probeD1 = dependencies?.probeD1 ?? (async (target) => {
    const client = new D1GatewayClient({
      baseUrl: target.baseUrl,
      token: target.token,
      ttlSeconds,
      maxActiveLinks,
    });
    return client.probe();
  });
  const openPostgres = dependencies?.openPostgres
    ?? ((databaseUrl: string) => PostgresShortLinkStore.open(databaseUrl));

  const target = gatewayTarget(env);
  if (target) {
    let available = false;
    try {
      available = await probeD1(target);
    } catch {
      available = false;
    }
    if (available) {
      return {
        backend: new D1GatewayClient({
          baseUrl: target.baseUrl,
          token: target.token,
          ttlSeconds,
          maxActiveLinks,
        }),
        backendType: "d1",
        ttlSeconds,
        maxActiveLinks,
      };
    }
  }

  const databaseUrl = requirePostgresUrl(env);
  let store: ShortLinkStore;
  try {
    store = await openPostgres(databaseUrl);
  } catch (error) {
    throw new StartupFailure(postgresStartupReason(error));
  }

  return {
    backend: new LocalShortLinkBackend(store, ttlSeconds, maxActiveLinks),
    backendType: "postgres",
    ttlSeconds,
    maxActiveLinks,
  };
}
