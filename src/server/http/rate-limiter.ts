import { isIP } from "node:net";

export interface RateLimiter {
  consume(key: string): { allowed: boolean; retryAfterSeconds: number };
}

export interface RateLimitRule {
  /** Maximum accepted requests per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

interface WindowEntry {
  count: number;
  resetAt: number;
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

/**
 * In-memory limiter that enforces several fixed windows per client at once
 * (for example per minute, per hour, and per day). A request is accepted only
 * when every window has room; blocked requests are not counted in any window.
 */
export function createRateLimiter(options: {
  rules: readonly RateLimitRule[];
  maxKeys: number;
  now?: () => number;
}): RateLimiter {
  const { rules, maxKeys } = options;
  if (rules.length === 0) {
    throw new RangeError("At least one rate limit rule is required");
  }
  for (const rule of rules) {
    assertPositiveSafeInteger(rule.limit, "limit");
    assertPositiveSafeInteger(rule.windowMs, "windowMs");
  }
  assertPositiveSafeInteger(maxKeys, "maxKeys");

  const now = options.now ?? Date.now;
  const entries = new Map<string, (WindowEntry | undefined)[]>();

  return {
    consume(key) {
      const currentTime = now();

      for (const [entryKey, windows] of entries) {
        if (
          windows.every(
            (window) => window === undefined || window.resetAt <= currentTime,
          )
        ) {
          entries.delete(entryKey);
        }
      }

      const windows = entries.get(key);
      const active = rules.map((_rule, index) => {
        const window = windows?.[index];
        return window !== undefined && window.resetAt > currentTime
          ? window
          : undefined;
      });

      let retryAfterMs = 0;
      active.forEach((window, index) => {
        if (window !== undefined && window.count >= rules[index].limit) {
          retryAfterMs = Math.max(retryAfterMs, window.resetAt - currentTime);
        }
      });
      if (retryAfterMs > 0) {
        return {
          allowed: false,
          retryAfterSeconds: Math.ceil(retryAfterMs / 1_000),
        };
      }

      if (windows === undefined && entries.size >= maxKeys) {
        const oldestActiveKey = entries.keys().next().value;
        if (oldestActiveKey !== undefined) {
          entries.delete(oldestActiveKey);
        }
      }

      entries.set(
        key,
        rules.map((rule, index) => {
          const window = active[index];
          if (window === undefined) {
            return { count: 1, resetAt: currentTime + rule.windowMs };
          }
          window.count += 1;
          return window;
        }),
      );
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}

export function createFixedWindowLimiter(options: {
  limit: number;
  windowMs: number;
  maxKeys: number;
  now?: () => number;
}): RateLimiter {
  return createRateLimiter({
    rules: [{ limit: options.limit, windowMs: options.windowMs }],
    maxKeys: options.maxKeys,
    now: options.now,
  });
}

export function resolveClientKey(input: {
  peerAddress: string;
  xForwardedFor?: string;
  trustProxy: boolean;
}): string {
  const peerAddress = input.peerAddress.trim();
  if (peerAddress.length === 0) {
    throw new Error("peerAddress is required");
  }

  const canonicalPeerAddress = canonicalizeIp(peerAddress) ?? peerAddress;

  if (!input.trustProxy || input.xForwardedFor === undefined) {
    return canonicalPeerAddress;
  }

  for (const entry of input.xForwardedFor.split(",")) {
    const address = canonicalizeIp(entry.trim());
    if (address !== undefined) {
      return address;
    }
  }

  return canonicalPeerAddress;
}

function canonicalizeIp(value: string): string | undefined {
  const version = isIP(value);
  if (version === 4) {
    return value;
  }
  if (version !== 6) {
    return undefined;
  }

  try {
    const hostname = new URL(`http://[${value}]/`).hostname;
    const canonicalAddress = hostname.slice(1, -1);
    return isIP(canonicalAddress) === 6 ? canonicalAddress : undefined;
  } catch {
    return undefined;
  }
}
