export type StartupFailureReason =
  | "public_base_url_missing"
  | "public_base_url_invalid"
  | "trust_proxy_invalid"
  | "rate_limit_invalid"
  | "cleanup_interval_invalid"
  | "ttl_invalid"
  | "max_active_links_invalid"
  | "database_url_invalid"
  | "postgres_unreachable"
  | "postgres_authentication_failed"
  | "postgres_database_missing"
  | "postgres_open_failed"
  | "listen_failed";

const GENERIC_MESSAGE = "Invalid short link backend configuration";

const MESSAGES: Record<StartupFailureReason, string> = {
  public_base_url_missing: "PUBLIC_BASE_URL is required in production",
  public_base_url_invalid: "PUBLIC_BASE_URL configuration is invalid",
  trust_proxy_invalid: "TRUST_PROXY configuration is invalid",
  rate_limit_invalid: "RATE_LIMIT configuration is invalid",
  cleanup_interval_invalid: "CLEANUP_INTERVAL_SECONDS configuration is invalid",
  ttl_invalid: GENERIC_MESSAGE,
  max_active_links_invalid: GENERIC_MESSAGE,
  database_url_invalid: GENERIC_MESSAGE,
  postgres_unreachable: GENERIC_MESSAGE,
  postgres_authentication_failed: GENERIC_MESSAGE,
  postgres_database_missing: GENERIC_MESSAGE,
  postgres_open_failed: GENERIC_MESSAGE,
  listen_failed: "Server failed to listen",
};

export class StartupFailure extends Error {
  readonly reason: StartupFailureReason;

  constructor(reason: StartupFailureReason) {
    super(MESSAGES[reason]);
    this.name = "StartupFailure";
    this.reason = reason;
  }
}

export function startupFailureReason(error: unknown): StartupFailureReason | "invalid_configuration_or_startup_failure" {
  return error instanceof StartupFailure
    ? error.reason
    : "invalid_configuration_or_startup_failure";
}

const UNREACHABLE_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETIMEDOUT",
]);

export function postgresStartupReason(error: unknown): StartupFailureReason {
  const code = errorCode(error);
  if (code === "3D000") return "postgres_database_missing";
  if (code === "28P01" || code === "28000") return "postgres_authentication_failed";
  if (code !== undefined && UNREACHABLE_CODES.has(code)) return "postgres_unreachable";
  return "postgres_open_failed";
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  if ("errors" in error && Array.isArray(error.errors)) {
    for (const item of error.errors) {
      const code = errorCode(item);
      if (code !== undefined) return code;
    }
  }
  if ("cause" in error) return errorCode(error.cause);
  return undefined;
}
