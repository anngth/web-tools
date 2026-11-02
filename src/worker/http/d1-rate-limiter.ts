import type { RateLimitRule } from "../../server/http/limits-config";

export interface D1RateLimiter {
  consume(key: string): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
}

interface WindowRow {
  window_ms: number;
  reset_at: number;
  count: number;
}

function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

/**
 * D1-backed version of the in-memory limiter in `server/http/rate-limiter.ts`:
 * several fixed windows per client, a request is accepted only when every
 * window has room, and blocked requests are not counted. Worker isolates do
 * not share memory, so the counters live in D1.
 */
export function createD1RateLimiter(options: {
  database: D1Database;
  rules: readonly RateLimitRule[];
  now?: () => number;
}): D1RateLimiter {
  const { database, rules } = options;
  if (rules.length === 0) {
    throw new RangeError("At least one rate limit rule is required");
  }
  const windows = new Set<number>();
  for (const rule of rules) {
    assertPositiveSafeInteger(rule.limit, "limit");
    assertPositiveSafeInteger(rule.windowMs, "windowMs");
    if (windows.has(rule.windowMs)) {
      throw new RangeError("Rate limit windows must be distinct");
    }
    windows.add(rule.windowMs);
  }
  const now = options.now ?? Date.now;

  // ?1 is the client key, ?2 the current time, then one (window, limit) pair
  // per rule. One statement keeps the check and the increments atomic.
  const ruleValues = rules.map((_rule, index) => `(?${3 + index * 2})`);
  const fullWindow = rules.map(
    (_rule, index) =>
      `(current.window_ms = ?${3 + index * 2} AND current.count >= ?${4 + index * 2})`,
  );
  const consumeSql = `
    INSERT INTO rate_limit_windows (client_key, window_ms, reset_at, count)
    SELECT ?1, rules.column1, ?2 + rules.column1, 1
    FROM (VALUES ${ruleValues.join(", ")}) AS rules
    WHERE NOT EXISTS (
      SELECT 1 FROM rate_limit_windows AS current
      WHERE current.client_key = ?1
        AND current.reset_at > ?2
        AND (${fullWindow.join(" OR ")})
    )
    ON CONFLICT (client_key, window_ms) DO UPDATE SET
      count = CASE WHEN rate_limit_windows.reset_at > ?2
        THEN rate_limit_windows.count + 1 ELSE 1 END,
      reset_at = CASE WHEN rate_limit_windows.reset_at > ?2
        THEN rate_limit_windows.reset_at ELSE excluded.reset_at END
  `;
  const ruleParameters = rules.flatMap((rule) => [rule.windowMs, rule.limit]);

  return {
    async consume(key) {
      const currentTime = now();
      const result = await database
        .prepare(consumeSql)
        .bind(key, currentTime, ...ruleParameters)
        .run();
      if (result.meta.changes > 0) {
        return { allowed: true, retryAfterSeconds: 0 };
      }

      const { results } = await database
        .prepare(`
          SELECT window_ms, reset_at, count
          FROM rate_limit_windows
          WHERE client_key = ? AND reset_at > ?
        `)
        .bind(key, currentTime)
        .all<WindowRow>();
      let retryAfterMs = 0;
      for (const row of results) {
        const rule = rules.find((candidate) => candidate.windowMs === row.window_ms);
        if (rule !== undefined && row.count >= rule.limit) {
          retryAfterMs = Math.max(retryAfterMs, row.reset_at - currentTime);
        }
      }
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1_000)),
      };
    },
  };
}

/** Removes windows that have ended; the scheduled cleanup calls this. */
export async function deleteExpiredRateLimitWindows(
  database: D1Database,
  now: Date,
): Promise<number> {
  const result = await database
    .prepare("DELETE FROM rate_limit_windows WHERE reset_at <= ?")
    .bind(now.getTime())
    .run();
  return result.meta.changes;
}
