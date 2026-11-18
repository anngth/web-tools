import { describe, expect, it } from "vitest";
import { fallbackToolId, parseDisabledTools } from "./disabledTools";
import { enabledTools, tools } from "./toolRegistry";

describe("parseDisabledTools", () => {
  it("is empty without a value", () => {
    for (const raw of [undefined, null, "", " , "]) {
      expect(parseDisabledTools(raw)).toEqual({
        ids: new Set(),
        unknown: [],
        allDisabled: false,
      });
    }
  });

  it("reads comma-separated ids, trimming blanks", () => {
    const result = parseDisabledTools(" url-shortener , ");
    expect([...result.ids]).toEqual(["url-shortener"]);
    expect(result.allDisabled).toBe(false);
  });

  it("reports unknown ids and ignores them", () => {
    const result = parseDisabledTools("url_shortener,constructor,totp");
    expect([...result.ids]).toEqual(["totp"]);
    expect(result.unknown).toEqual(["url_shortener", "constructor"]);
  });

  it("drops the list when it would hide every tool", () => {
    const result = parseDisabledTools("totp,url-shortener");
    expect(result.ids.size).toBe(0);
    expect(result.allDisabled).toBe(true);
  });
});

describe("fallbackToolId", () => {
  it("prefers TOTP, then the first enabled tool", () => {
    expect(fallbackToolId(new Set())).toBe("totp");
    expect(fallbackToolId(new Set(["url-shortener"]))).toBe("totp");
    expect(fallbackToolId(new Set(["totp"]))).toBe("url-shortener");
  });
});

describe("enabledTools", () => {
  it("removes disabled tools from the registry list", () => {
    expect(enabledTools(tools, new Set(["url-shortener"])).map((t) => t.id)).toEqual(["totp"]);
    expect(enabledTools(tools, new Set())).toEqual(tools);
  });
});
