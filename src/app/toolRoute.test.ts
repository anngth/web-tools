import { describe, expect, it } from "vitest";
import { tools } from "./toolRegistry";
import { seoToolIdFromPathname, toolSeoData } from "./toolSeoData";
import {
  RESERVED_PATH_SEGMENTS,
  canonicalPathname,
  pathnameForTool,
  toolIdFromPathname,
} from "./toolRoute";

describe("toolRoute", () => {
  it("maps known tool paths to tool ids", () => {
    expect(toolIdFromPathname("/totp")).toBe("totp");
    expect(toolIdFromPathname("/url-shortener")).toBe("url-shortener");
    expect(toolIdFromPathname("/url-shortener/")).toBe("url-shortener");
  });

  it("falls back to the first tool for unknown paths", () => {
    expect(toolIdFromPathname("/")).toBe("totp");
    expect(toolIdFromPathname("/tools/totp")).toBe("totp");
    expect(toolIdFromPathname("/bogus")).toBe("totp");
    expect(toolIdFromPathname("/url-shortener/extra")).toBe("totp");
    expect(toolIdFromPathname("/foo")).toBe("totp");
  });

  it("builds pathnames from tool ids", () => {
    expect(pathnameForTool("totp")).toBe("/totp");
    expect(pathnameForTool("url-shortener")).toBe("/url-shortener");
  });

  it("canonicalizes pathnames", () => {
    expect(canonicalPathname("/url-shortener/")).toBe(
      "/url-shortener",
    );
    expect(canonicalPathname("/bogus")).toBe("/totp");
    expect(canonicalPathname("/")).toBe("/totp");
  });

  it("keeps server SEO metadata in sync with the tool registry", () => {
    expect(Object.keys(toolSeoData).sort()).toEqual(
      tools.map((tool) => tool.id).sort(),
    );
    for (const pathname of ["/", "/totp", "/url-shortener/", "/bogus", "/a/b"]) {
      expect(seoToolIdFromPathname(pathname)).toBe(
        toolIdFromPathname(pathname),
      );
    }
    expect(seoToolIdFromPathname("/constructor")).toBe("totp");
  });

  it("never uses a path segment reserved by the server as a tool id", () => {
    for (const tool of tools) {
      expect(RESERVED_PATH_SEGMENTS).not.toContain(tool.id);
    }
  });
});
