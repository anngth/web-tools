import { describe, expect, it } from "vitest";

import {
  createFixedWindowLimiter,
  resolveClientKey,
} from "./rate-limiter";

function createLimiter(now: () => number) {
  return createFixedWindowLimiter({
    limit: 10,
    windowMs: 60_000,
    maxKeys: 10_000,
    now,
  });
}

describe("createFixedWindowLimiter", () => {
  it("allows attempts one through ten and blocks attempt eleven", () => {
    const limiter = createLimiter(() => 0);

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      expect(limiter.consume("client")).toEqual({
        allowed: true,
        retryAfterSeconds: 0,
      });
    }

    expect(limiter.consume("client")).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
  });

  it("ceiling-rounds retry-after to whole seconds", () => {
    let time = 0;
    const limiter = createLimiter(() => time);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      limiter.consume("client");
    }

    time = 59_001;
    expect(limiter.consume("client")).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
  });

  it("starts a fresh fixed window at the exact reset boundary", () => {
    let time = 1_000;
    const limiter = createLimiter(() => time);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      limiter.consume("client");
    }

    time = 61_000;
    expect(limiter.consume("client")).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });

    time = 61_001;
    for (let attempt = 0; attempt < 9; attempt += 1) {
      expect(limiter.consume("client").allowed).toBe(true);
    }
    expect(limiter.consume("client")).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
    });
  });

  it("removes every expired entry before considering active eviction", () => {
    let time = 0;
    const limiter = createLimiter(() => time);

    for (let index = 0; index < 5_000; index += 1) {
      limiter.consume(`expired-${index}`);
    }

    time = 59_999;
    for (let index = 0; index < 5_000; index += 1) {
      limiter.consume(`active-${index}`);
    }

    time = 60_000;
    limiter.consume("new-client");

    for (let attempt = 0; attempt < 9; attempt += 1) {
      expect(limiter.consume("active-0").allowed).toBe(true);
    }
    expect(limiter.consume("active-0").allowed).toBe(false);
  });

  it("evicts the oldest active entry when adding key 10,001", () => {
    let time = 0;
    const limiter = createLimiter(() => time);

    for (let index = 0; index < 10_000; index += 1) {
      limiter.consume(`client-${index}`);
    }

    time = 1;
    limiter.consume("client-10_000");

    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(limiter.consume("client-0").allowed).toBe(true);
    }
    expect(limiter.consume("client-0").allowed).toBe(false);
  });
});

describe("resolveClientKey", () => {
  it("requires a direct peer address", () => {
    expect(() =>
      resolveClientKey({
        peerAddress: "   ",
        trustProxy: false,
      }),
    ).toThrow("peerAddress is required");
  });

  it("uses a non-IP direct peer identifier when proxy trust is disabled", () => {
    expect(
      resolveClientKey({
        peerAddress: "  unix/socket-peer  ",
        trustProxy: false,
      }),
    ).toBe("unix/socket-peer");
  });

  it("falls back to a non-IP direct peer identifier when trusted entries are invalid", () => {
    expect(
      resolveClientKey({
        peerAddress: "opaque-peer",
        xForwardedFor: "unknown, example.com, 198.51.100.4:443",
        trustProxy: true,
      }),
    ).toBe("opaque-peer");
  });

  it("canonicalizes a direct IP peer when possible", () => {
    expect(
      resolveClientKey({
        peerAddress: "2001:0DB8:0000:0000:0000:0000:0000:0001",
        trustProxy: false,
      }),
    ).toBe("2001:db8::1");
  });

  it("ignores forwarded addresses unless proxy trust is enabled", () => {
    expect(
      resolveClientKey({
        peerAddress: "203.0.113.9",
        xForwardedFor: "not-an-ip, 198.51.100.4",
        trustProxy: false,
      }),
    ).toBe("203.0.113.9");
  });

  it("skips malformed entries and uses the first valid trusted IPv4 address", () => {
    expect(
      resolveClientKey({
        peerAddress: "203.0.113.9",
        xForwardedFor:
          "unknown, example.com, 198.51.100.4:443, 198.51.100.4, 192.0.2.1",
        trustProxy: true,
      }),
    ).toBe("198.51.100.4");
  });

  it("accepts and canonicalizes the first valid trusted IPv6 address", () => {
    expect(
      resolveClientKey({
        peerAddress: "203.0.113.9",
        xForwardedFor:
          "[2001:db8::1], fe80::1%eth0, 2001:0DB8:0000:0000:0000:0000:0000:0001, 198.51.100.4",
        trustProxy: true,
      }),
    ).toBe("2001:db8::1");
  });

  it("falls back to the direct peer when no trusted entry is a strict IP token", () => {
    expect(
      resolveClientKey({
        peerAddress: "203.0.113.9",
        xForwardedFor:
          "unknown, example.com, 198.51.100.4:443, [2001:db8::1], 01.2.3.4",
        trustProxy: true,
      }),
    ).toBe("203.0.113.9");
  });

  it("skips empty trusted entries", () => {
    expect(
      resolveClientKey({
        peerAddress: "203.0.113.9",
        xForwardedFor: "  , , 198.51.100.4",
        trustProxy: true,
      }),
    ).toBe("198.51.100.4");
  });
});
