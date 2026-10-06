import { describe, expect, it } from "vitest";
import { isShortLinkError, ShortLinkError } from "./model";
import {
  computeExpiresAt,
  isExpired,
  validateCustomAlias,
  validateDestinationUrl,
  validateTtlSeconds,
} from "./validation";

describe("validateDestinationUrl", () => {
  it.each([
    [
      "https://example.com/path?query=value#fragment",
      "https://example.com/path?query=value#fragment",
    ],
    ["http://example.com", "http://example.com/"],
    ["https://8.8.8.8/dns-query", "https://8.8.8.8/dns-query"],
    [
      "https://[2606:4700:4700::1111]/dns-query",
      "https://[2606:4700:4700::1111]/dns-query",
    ],
  ])("accepts the public HTTP(S) URL %s", (value, expected) => {
    expect(validateDestinationUrl(value)).toBe(expected);
  });

  it.each([
    ["a non-string value", 42],
    ["an empty value", ""],
    ["a malformed URL", "not a url"],
    ["a relative URL", "/relative"],
    ["an unsupported scheme", "ftp://example.com/file"],
    ["embedded credentials", "https://user:password@example.com/private"],
    ["localhost", "http://localhost:8080"],
    ["a localhost subdomain", "http://app.localhost"],
    ["an IPv4 loopback literal", "http://127.0.0.1"],
    ["a non-decimal IPv4 loopback literal", "http://0x7f000001"],
    ["a private 10/8 IPv4 literal", "http://10.2.3.4"],
    ["a private 172.16/12 IPv4 literal", "http://172.31.255.255"],
    ["a private 192.168/16 IPv4 literal", "http://192.168.1.10"],
    ["a link-local IPv4 literal", "http://169.254.10.20"],
    ["the unspecified IPv6 literal", "http://[::]"],
    ["the IPv6 loopback literal", "http://[::1]"],
    ["a private IPv6 literal", "http://[fd12:3456:789a::1]"],
    ["a link-local IPv6 literal", "http://[fe80::1]"],
    ["an IPv4-mapped private IPv6 literal", "http://[::ffff:192.168.1.1]"],
  ])("rejects %s", (_description, value) => {
    expect(() => validateDestinationUrl(value)).toThrow(ShortLinkError);
  });
});

describe("validateCustomAlias", () => {
  it("allows an omitted alias", () => {
    expect(validateCustomAlias(undefined)).toBeUndefined();
  });

  it("trims and lowercases a valid alias", () => {
    expect(validateCustomAlias("  My-Link-123  ")).toBe("my-link-123");
  });

  it.each([
    ["a non-string value", 123],
    ["an empty value", ""],
    ["an alias shorter than three characters", "ab"],
    ["an alias longer than 48 characters", "a".repeat(49)],
    ["spaces inside an alias", "my link"],
    ["underscores", "my_link"],
    ["non-ASCII characters", "café"],
  ])("rejects %s", (_description, value) => {
    expect(() => validateCustomAlias(value)).toThrow(ShortLinkError);
  });
});

describe("validateTtlSeconds", () => {
  it("defaults to 30 days", () => {
    expect(validateTtlSeconds(undefined)).toBe(2_592_000);
  });

  it("accepts decimal digits representing a positive integer", () => {
    expect(validateTtlSeconds("300")).toBe(300);
  });

  it.each([
    "",
    "0",
    "-1",
    "+1",
    "1.5",
    " 300 ",
    "1e3",
    "Infinity",
    "9007199254740992",
  ])(
    "rejects the invalid TTL %j",
    (value) => {
      expect(() => validateTtlSeconds(value)).toThrow(ShortLinkError);
    },
  );
});

describe("expiration", () => {
  it("computes an ISO timestamp from integer milliseconds", () => {
    expect(
      computeExpiresAt(new Date("2026-07-12T00:00:00.000Z"), 300),
    ).toBe("2026-07-12T00:05:00.000Z");
  });

  it("treats the exact expiration boundary as expired", () => {
    expect(
      isExpired(
        "2026-07-12T00:05:00.000Z",
        new Date("2026-07-12T00:05:00.000Z"),
      ),
    ).toBe(true);
  });

  it("keeps a link active before its expiration", () => {
    expect(
      isExpired(
        "2026-07-12T00:05:00.000Z",
        new Date("2026-07-12T00:04:59.999Z"),
      ),
    ).toBe(false);
  });
});

describe("ShortLinkError", () => {
  it("supports stable typed error checks", () => {
    const collision = new ShortLinkError("alias_collision");

    expect(isShortLinkError(collision)).toBe(true);
    expect(isShortLinkError(collision, "alias_collision")).toBe(true);
    expect(isShortLinkError(collision, "validation")).toBe(false);
    expect(isShortLinkError(new Error("alias_collision"))).toBe(false);
  });

  it("serializes only its stable code and uses a generic message", () => {
    const collision = new ShortLinkError("alias_collision");
    const serialized = JSON.stringify(collision);

    expect(collision.message).toBe("Short link operation failed");
    expect(Object.keys(collision)).toEqual(["code"]);
    expect(serialized).toBe('{"code":"alias_collision"}');
    expect(serialized).not.toContain("destinationUrl");
    expect(serialized).not.toContain("cause");
  });
});
