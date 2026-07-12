import { describe, expect, it } from "vitest";
import { D1GatewayClient } from "./d1-gateway-client";
import { createShortLinkBackend } from "./backend-factory";
import { LocalShortLinkBackend } from "./local-backend";

describe("createShortLinkBackend", () => {
  it("selects SQLite with the default TTL and trims its configuration", async () => {
    const selection = createShortLinkBackend({
      DATABASE_BACKEND: " sqlite ",
      SQLITE_PATH: " :memory: ",
    });

    expect(selection.backendType).toBe("sqlite");
    expect(selection.ttlSeconds).toBe(2_592_000);
    expect(selection.backend).toBeInstanceOf(LocalShortLinkBackend);
    await selection.backend.close?.();
  });

  it("selects D1 with a positive integer TTL and trimmed settings", () => {
    const selection = createShortLinkBackend({
      DATABASE_BACKEND: " d1 ",
      D1_GATEWAY_URL: " https://gateway.example.test/root/ ",
      D1_GATEWAY_TOKEN: " token ",
      URL_SHORTENER_TTL_SECONDS: " 300 ",
    });

    expect(selection).toMatchObject({ backendType: "d1", ttlSeconds: 300 });
    expect(selection.backend).toBeInstanceOf(D1GatewayClient);
  });

  it.each(["", " ", "0", "-1", "1.5", "10e2", "NaN", "9007199254740992"])(
    "rejects invalid TTL %j",
    (ttl) => {
      expect(() => createShortLinkBackend({
        DATABASE_BACKEND: "sqlite",
        SQLITE_PATH: ":memory:",
        URL_SHORTENER_TTL_SECONDS: ttl,
      })).toThrow();
    },
  );

  it.each([undefined, "", " ", "SQLITE", "postgres"])("rejects missing or unknown backend %j", (backend) => {
    expect(() => createShortLinkBackend({ DATABASE_BACKEND: backend, SQLITE_PATH: ":memory:" })).toThrow();
  });

  it.each([undefined, "", "   "])("rejects missing or blank SQLite paths", (path) => {
    expect(() => createShortLinkBackend({ DATABASE_BACKEND: "sqlite", SQLITE_PATH: path })).toThrow();
  });

  it.each([
    undefined,
    "",
    "gateway.example.test",
    "/relative",
    "ftp://gateway.example.test",
    "https://user:pass@gateway.example.test",
    "https://user@gateway.example.test",
  ])("rejects invalid D1 gateway URLs %j", (baseUrl) => {
    expect(() => createShortLinkBackend({
      DATABASE_BACKEND: "d1",
      D1_GATEWAY_URL: baseUrl,
      D1_GATEWAY_TOKEN: "token",
    })).toThrow();
  });

  it.each([undefined, "", "   "])("rejects missing or blank D1 tokens", (token) => {
    expect(() => createShortLinkBackend({
      DATABASE_BACKEND: "d1",
      D1_GATEWAY_URL: "https://gateway.example.test",
      D1_GATEWAY_TOKEN: token,
    })).toThrow();
  });

  it("does not open SQLite when D1 is selected", () => {
    expect(() => createShortLinkBackend({
      DATABASE_BACKEND: "d1",
      SQLITE_PATH: "/definitely/missing/parent/database.sqlite",
      D1_GATEWAY_URL: "https://gateway.example.test",
      D1_GATEWAY_TOKEN: "token",
    })).not.toThrow();
  });

  it("does not construct D1 when SQLite is selected", async () => {
    const selection = createShortLinkBackend({
      DATABASE_BACKEND: "sqlite",
      SQLITE_PATH: ":memory:",
      D1_GATEWAY_URL: "not a URL",
      D1_GATEWAY_TOKEN: "",
    });
    expect(selection.backend).toBeInstanceOf(LocalShortLinkBackend);
    await selection.backend.close?.();
  });
});
