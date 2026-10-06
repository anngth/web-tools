import type { RateLimitRule } from "./rate-limiter";

export interface RateLimitEnvironment {
  RATE_LIMIT_PER_MINUTE?: string;
  RATE_LIMIT_PER_HOUR?: string;
  RATE_LIMIT_PER_DAY?: string;
}

export interface MaxActiveLinksEnvironment {
  MAX_ACTIVE_LINKS?: string;
}

export const DEFAULT_MAX_ACTIVE_LINKS = 100_000;

const RATE_LIMIT_WINDOWS = [
  { name: "RATE_LIMIT_PER_MINUTE", windowMs: 60_000, defaultLimit: 10 },
  { name: "RATE_LIMIT_PER_HOUR", windowMs: 3_600_000, defaultLimit: 60 },
  { name: "RATE_LIMIT_PER_DAY", windowMs: 86_400_000, defaultLimit: 200 },
] as const;

/**
 * Parses an optional non-negative integer variable. Blank values are unset.
 * Error messages name the variable but never echo its value.
 */
function parseOptionalCount(
  name: string,
  raw: string | undefined,
): number | undefined {
  const value = raw?.trim() ?? "";
  if (value === "") return undefined;
  if (!/^\d+$/.test(value)) {
    throw new TypeError(`${name} configuration is invalid`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new TypeError(`${name} configuration is invalid`);
  }
  return parsed;
}

/**
 * Per-client fixed-window quotas. Each window can be tuned through its
 * `RATE_LIMIT_PER_*` variable; `0` disables that window.
 */
export function parseRateLimitRules(
  env: RateLimitEnvironment,
): RateLimitRule[] {
  const rules: RateLimitRule[] = [];
  for (const window of RATE_LIMIT_WINDOWS) {
    const limit =
      parseOptionalCount(window.name, env[window.name]) ?? window.defaultLimit;
    if (limit > 0) rules.push({ limit, windowMs: window.windowMs });
  }
  if (rules.length === 0) {
    throw new TypeError("At least one RATE_LIMIT_PER_* window must be enabled");
  }
  return rules;
}

/** Cap on simultaneously active links; `undefined` means unlimited (`0`). */
export function parseMaxActiveLinks(
  env: MaxActiveLinksEnvironment,
): number | undefined {
  const parsed =
    parseOptionalCount("MAX_ACTIVE_LINKS", env.MAX_ACTIVE_LINKS) ??
    DEFAULT_MAX_ACTIVE_LINKS;
  return parsed > 0 ? parsed : undefined;
}
