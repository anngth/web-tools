import { isIP } from "node:net";

export interface FixedWindowLimiter {
  consume(key: string): { allowed: boolean; retryAfterSeconds: number };
}

interface WindowEntry {
  count: number;
  resetAt: number;
}

export function createFixedWindowLimiter(options: {
  limit: 10;
  windowMs: 60_000;
  maxKeys: 10_000;
  now?: () => number;
}): FixedWindowLimiter {
  const now = options.now ?? Date.now;
  const entries = new Map<string, WindowEntry>();

  return {
    consume(key) {
      const currentTime = now();

      for (const [entryKey, entry] of entries) {
        if (entry.resetAt <= currentTime) {
          entries.delete(entryKey);
        }
      }

      const existing = entries.get(key);
      if (existing !== undefined) {
        if (existing.count >= options.limit) {
          return {
            allowed: false,
            retryAfterSeconds: Math.ceil(
              (existing.resetAt - currentTime) / 1_000,
            ),
          };
        }

        existing.count += 1;
        return { allowed: true, retryAfterSeconds: 0 };
      }

      if (entries.size >= options.maxKeys) {
        const oldestActiveKey = entries.keys().next().value;
        if (oldestActiveKey !== undefined) {
          entries.delete(oldestActiveKey);
        }
      }

      entries.set(key, {
        count: 1,
        resetAt: currentTime + options.windowMs,
      });
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
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
