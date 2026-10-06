import { describe, expect, it, vi } from "vitest";
import type { ShortLinkStore } from "../../shared/short-links/short-link-backend.ts";
import { selectShortLinkBackend } from "./backend-selector";

const d1Env = {
  D1_GATEWAY_URL: "https://gateway.example.com",
  D1_GATEWAY_TOKEN: "token",
  DATABASE_URL: "postgres://user:secret@localhost:5432/links",
  URL_SHORTENER_TTL_SECONDS: "60",
};

describe("selectShortLinkBackend", () => {
  it("selects D1 and does not open Postgres for the exact probe", async () => {
    const probeD1 = vi.fn(async () => true);
    const openPostgres = vi.fn();
    const selection = await selectShortLinkBackend(d1Env, { probeD1, openPostgres });
    expect(selection.backendType).toBe("d1");
    expect(openPostgres).not.toHaveBeenCalled();
  });

  it.each(["  ", "http://localhost/db"])(
    "selects D1 and ignores DATABASE_URL %j",
    async (databaseUrl) => {
      const openPostgres = vi.fn();
      const selection = await selectShortLinkBackend(
        { ...d1Env, DATABASE_URL: databaseUrl },
        { probeD1: async () => true, openPostgres },
      );
      expect(selection.backendType).toBe("d1");
      expect(openPostgres).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["missing token", { ...d1Env, D1_GATEWAY_TOKEN: "" }],
    ["invalid gateway", { ...d1Env, D1_GATEWAY_URL: "ftp://gateway.example.com" }],
    ["gateway credentials", { ...d1Env, D1_GATEWAY_URL: "https://user:pass@gateway.example.com" }],
  ])("does not probe D1 for %s", async (_name, env) => {
    const probeD1 = vi.fn();
    const openPostgres = vi.fn(async () => ({ close: vi.fn() }) as ShortLinkStore);
    const selection = await selectShortLinkBackend(env, { probeD1, openPostgres });
    expect(selection.backendType).toBe("postgres");
    expect(probeD1).not.toHaveBeenCalled();
  });

  it("falls back when the probe returns false or throws", async () => {
    const openPostgres = vi.fn(async () => ({ close: vi.fn() }) as ShortLinkStore);
    await expect(selectShortLinkBackend(d1Env, {
      probeD1: async () => false,
      openPostgres,
    })).resolves.toMatchObject({ backendType: "postgres" });
    await expect(selectShortLinkBackend(d1Env, {
      probeD1: async () => { throw new Error("socket hang up"); },
      openPostgres,
    })).resolves.toMatchObject({ backendType: "postgres" });
    expect(openPostgres).toHaveBeenCalledWith("postgres://user:secret@localhost:5432/links");
  });

  it("throws the generic error when fallback Postgres is missing", async () => {
    await expect(selectShortLinkBackend(
      { ...d1Env, DATABASE_URL: undefined },
      { probeD1: async () => false, openPostgres: vi.fn() },
    )).rejects.toThrow("Invalid short link backend configuration");
  });

  it("hides driver text when Postgres open fails", async () => {
    const openPostgres = vi.fn(async () => {
      throw new Error("password=secret connection refused");
    });
    const error = await selectShortLinkBackend(d1Env, {
      probeD1: async () => false,
      openPostgres,
    }).catch((caught: unknown) => caught);
    expect(error).toEqual(new Error("Invalid short link backend configuration"));
  });

  it("rejects an invalid TTL before probing", async () => {
    const probeD1 = vi.fn();
    const openPostgres = vi.fn();
    await expect(selectShortLinkBackend(
      { ...d1Env, URL_SHORTENER_TTL_SECONDS: "0" },
      { probeD1, openPostgres },
    )).rejects.toThrow("Invalid short link backend configuration");
    expect(probeD1).not.toHaveBeenCalled();
    expect(openPostgres).not.toHaveBeenCalled();
  });

  it("rejects an invalid max active links count before probing or opening Postgres", async () => {
    const probeD1 = vi.fn();
    const openPostgres = vi.fn();
    await expect(selectShortLinkBackend(
      { ...d1Env, MAX_ACTIVE_LINKS: "many" },
      { probeD1, openPostgres },
    )).rejects.toThrow(new Error("Invalid short link backend configuration"));
    expect(probeD1).not.toHaveBeenCalled();
    expect(openPostgres).not.toHaveBeenCalled();
  });

  it("rejects a non-postgres DATABASE_URL when D1 is not selected", async () => {
    const probeD1 = vi.fn();
    const openPostgres = vi.fn();
    await expect(selectShortLinkBackend(
      {
        ...d1Env,
        D1_GATEWAY_URL: undefined,
        D1_GATEWAY_TOKEN: undefined,
        DATABASE_URL: "http://localhost/db",
      },
      { probeD1, openPostgres },
    )).rejects.toThrow(new Error("Invalid short link backend configuration"));
    expect(probeD1).not.toHaveBeenCalled();
    expect(openPostgres).not.toHaveBeenCalled();
  });
});
