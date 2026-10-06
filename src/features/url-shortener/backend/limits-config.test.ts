import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_ACTIVE_LINKS,
  parseMaxActiveLinks,
  parseRateLimitRules,
} from "./limits-config";

describe("parseRateLimitRules", () => {
  it("uses per-minute, per-hour, and per-day defaults", () => {
    expect(parseRateLimitRules({})).toEqual([
      { limit: 10, windowMs: 60_000 },
      { limit: 60, windowMs: 3_600_000 },
      { limit: 200, windowMs: 86_400_000 },
    ]);
  });

  it("treats blank values as unset", () => {
    expect(
      parseRateLimitRules({
        RATE_LIMIT_PER_MINUTE: "",
        RATE_LIMIT_PER_HOUR: "   ",
        RATE_LIMIT_PER_DAY: "",
      }),
    ).toEqual(parseRateLimitRules({}));
  });

  it("reads each window from its environment variable", () => {
    expect(
      parseRateLimitRules({
        RATE_LIMIT_PER_MINUTE: "3",
        RATE_LIMIT_PER_HOUR: " 20 ",
        RATE_LIMIT_PER_DAY: "100",
      }),
    ).toEqual([
      { limit: 3, windowMs: 60_000 },
      { limit: 20, windowMs: 3_600_000 },
      { limit: 100, windowMs: 86_400_000 },
    ]);
  });

  it("disables a window with 0", () => {
    expect(
      parseRateLimitRules({
        RATE_LIMIT_PER_HOUR: "0",
        RATE_LIMIT_PER_DAY: "0",
      }),
    ).toEqual([{ limit: 10, windowMs: 60_000 }]);
  });

  it("rejects disabling every window", () => {
    expect(() =>
      parseRateLimitRules({
        RATE_LIMIT_PER_MINUTE: "0",
        RATE_LIMIT_PER_HOUR: "0",
        RATE_LIMIT_PER_DAY: "0",
      }),
    ).toThrow("At least one RATE_LIMIT_PER_* window must be enabled");
  });

  it.each(["abc", "-1", "1.5", "1e3", "0x10", "99999999999999999999"])(
    "rejects invalid value %j without echoing it",
    (value) => {
      let message = "";
      try {
        parseRateLimitRules({ RATE_LIMIT_PER_HOUR: value });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toBe("RATE_LIMIT_PER_HOUR configuration is invalid");
    },
  );
});

describe("parseMaxActiveLinks", () => {
  it("defaults to the built-in cap", () => {
    expect(parseMaxActiveLinks({})).toBe(DEFAULT_MAX_ACTIVE_LINKS);
    expect(parseMaxActiveLinks({ MAX_ACTIVE_LINKS: " " })).toBe(
      DEFAULT_MAX_ACTIVE_LINKS,
    );
  });

  it("reads MAX_ACTIVE_LINKS", () => {
    expect(parseMaxActiveLinks({ MAX_ACTIVE_LINKS: " 500 " })).toBe(500);
  });

  it("returns undefined when the cap is disabled with 0", () => {
    expect(parseMaxActiveLinks({ MAX_ACTIVE_LINKS: "0" })).toBeUndefined();
  });

  it.each(["abc", "-5", "2.5", "1e3"])("rejects invalid value %j", (value) => {
    expect(() => parseMaxActiveLinks({ MAX_ACTIVE_LINKS: value })).toThrow(
      "MAX_ACTIVE_LINKS configuration is invalid",
    );
  });
});
