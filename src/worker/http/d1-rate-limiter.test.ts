import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  createD1RateLimiter,
  deleteExpiredRateLimitWindows,
} from "./d1-rate-limiter";

const START = Date.parse("2026-07-12T00:00:00.000Z");

function limiter(clock: { now: number }) {
  return createD1RateLimiter({
    database: env.DB,
    rules: [
      { limit: 2, windowMs: 60_000 },
      { limit: 3, windowMs: 3_600_000 },
    ],
    now: () => clock.now,
  });
}

describe("D1 rate limiter", () => {
  it("accepts until a window is full and reports the wait", async () => {
    const clock = { now: START };
    const subject = limiter(clock);

    expect(await subject.consume("203.0.113.8")).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    expect((await subject.consume("203.0.113.8")).allowed).toBe(true);

    clock.now = START + 15_000;
    expect(await subject.consume("203.0.113.8")).toEqual({
      allowed: false,
      retryAfterSeconds: 45,
    });
    expect((await subject.consume("198.51.100.1")).allowed).toBe(true);
  });

  it("does not count blocked requests and resets ended windows", async () => {
    const clock = { now: START };
    const subject = limiter(clock);
    await subject.consume("client");
    await subject.consume("client");
    await subject.consume("client");

    clock.now = START + 60_000;
    expect((await subject.consume("client")).allowed).toBe(true);
    const hour = await env.DB.prepare(
      "SELECT count FROM rate_limit_windows WHERE client_key = ? AND window_ms = ?",
    )
      .bind("client", 3_600_000)
      .first<{ count: number }>();
    expect(hour?.count).toBe(3);

    expect(await subject.consume("client")).toEqual({
      allowed: false,
      retryAfterSeconds: 3_540,
    });
  });

  it("deletes only windows that have ended", async () => {
    const clock = { now: START };
    await limiter(clock).consume("client");

    expect(
      await deleteExpiredRateLimitWindows(env.DB, new Date(START + 60_000)),
    ).toBe(1);
    const remaining = await env.DB.prepare(
      "SELECT window_ms FROM rate_limit_windows",
    ).all<{ window_ms: number }>();
    expect(remaining.results).toEqual([{ window_ms: 3_600_000 }]);
  });

  it("rejects empty or duplicate rules", () => {
    expect(() => createD1RateLimiter({ database: env.DB, rules: [] })).toThrow(RangeError);
    expect(() =>
      createD1RateLimiter({
        database: env.DB,
        rules: [
          { limit: 1, windowMs: 60_000 },
          { limit: 2, windowMs: 60_000 },
        ],
      }),
    ).toThrow(RangeError);
    expect(() =>
      createD1RateLimiter({ database: env.DB, rules: [{ limit: 0, windowMs: 1 }] }),
    ).toThrow(RangeError);
  });
});
