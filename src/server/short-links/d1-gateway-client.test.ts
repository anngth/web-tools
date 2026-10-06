import { afterEach, describe, expect, it, vi } from "vitest";
import { ShortLinkError } from "../../shared/short-links/model.ts";
import { D1GatewayClient } from "./d1-gateway-client";

const NOW = new Date("2026-07-12T03:04:05.006Z");
const LINK = {
  slug: "docs",
  destinationUrl: "https://example.com/private",
  createdAt: "2026-07-12T03:04:05.006Z",
  expiresAt: "2026-07-12T03:09:05.006Z",
  clickCount: 0,
  lastClickedAt: null,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeClient(fetchImpl: typeof fetch, options: { timeoutMs?: number } = {}) {
  return new D1GatewayClient({
    baseUrl: "https://gateway.example.test/root/",
    token: "very-secret-token",
    ttlSeconds: 300,
    fetch: fetchImpl,
    ...options,
  });
}

describe("D1GatewayClient", () => {
  afterEach(() => vi.restoreAllMocks());

  it("makes one authenticated request per operation using the exact Worker wire contract", async () => {
    const timeoutSignal = AbortSignal.abort();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeoutSignal);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(LINK, 201))
      .mockResolvedValueOnce(jsonResponse({ status: 302, destinationUrl: LINK.destinationUrl }))
      .mockResolvedValueOnce(jsonResponse(LINK))
      .mockResolvedValueOnce(jsonResponse({ deletedCount: 4 }));
    const client = makeClient(fetchMock);

    await expect(client.create({ destinationUrl: LINK.destinationUrl, customAlias: "docs" }, NOW)).resolves.toEqual(LINK);
    await expect(client.resolve("a/b c", NOW)).resolves.toEqual({ status: 302, destinationUrl: LINK.destinationUrl });
    await expect(client.stats("a/b c", NOW)).resolves.toEqual(LINK);
    await expect(client.deleteExpired(NOW)).resolves.toBe(4);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(timeout).toHaveBeenCalledTimes(4);
    expect(timeout).toHaveBeenCalledWith(10_000);

    const expectedNow = encodeURIComponent(NOW.toISOString());
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      "https://gateway.example.test/root/internal/links",
      `https://gateway.example.test/root/internal/links/a%2Fb%20c/resolve?now=${expectedNow}`,
      `https://gateway.example.test/root/internal/links/a%2Fb%20c/stats?now=${expectedNow}`,
      "https://gateway.example.test/root/internal/cleanup",
    ]);

    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.headers).toEqual({
        authorization: "Bearer very-secret-token",
        "content-type": "application/json",
      });
      expect(init?.signal).toBe(timeoutSignal);
    }
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(["POST", "GET", "GET", "POST"]);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      input: { destinationUrl: LINK.destinationUrl, customAlias: "docs" },
      now: NOW.toISOString(),
      ttlSeconds: 300,
    });
    expect(fetchMock.mock.calls[1][1]?.body).toBeUndefined();
    expect(fetchMock.mock.calls[2][1]?.body).toBeUndefined();
    expect(JSON.parse(String(fetchMock.mock.calls[3][1]?.body))).toEqual({ now: NOW.toISOString() });
  });

  it("sends the active link cap only when configured", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(LINK, 201));
    const client = new D1GatewayClient({
      baseUrl: "https://gateway.example.test/root/",
      token: "very-secret-token",
      ttlSeconds: 300,
      maxActiveLinks: 1_000,
      fetch: fetchMock,
    });

    await client.create({ destinationUrl: LINK.destinationUrl }, NOW);

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      ttlSeconds: 300,
      maxActiveLinks: 1_000,
    });
  });

  it("maps a 507 capacity response to a typed capacity error", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: "capacity_reached" }, 507));
    const client = makeClient(fetchMock);

    await expect(client.create({ destinationUrl: LINK.destinationUrl }, NOW)).rejects.toMatchObject({ code: "capacity" });
  });

  it("uses the configured timeout and never forwards an input expiration", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(LINK, 201));
    const client = makeClient(fetchMock, { timeoutMs: 25 });
    const input = { destinationUrl: LINK.destinationUrl, expiresAt: "2099-01-01T00:00:00.000Z" } as never;

    await client.create(input, NOW);

    expect(timeout).toHaveBeenCalledWith(25);
    const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(payload.input).toEqual({ destinationUrl: LINK.destinationUrl });
    expect(JSON.stringify(payload)).not.toContain("2099");
  });

  it.each([
    ["resolve", "."],
    ["resolve", ".."],
    ["stats", "."],
    ["stats", ".."],
  ] as const)("treats the dot-only %s slug %j as missing without a gateway request", async (operation, slug) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ error: "not_found" }, 404));
    const client = makeClient(fetchMock);

    if (operation === "resolve") {
      await expect(client.resolve(slug, NOW)).resolves.toEqual({ status: 404 });
    } else {
      await expect(client.stats(slug, NOW)).resolves.toBeNull();
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps HTTP and payload missing records to the backend missing values", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: "not_found" }, 404))
      .mockResolvedValueOnce(jsonResponse({ status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ error: "not_found" }, 404));
    const client = makeClient(fetchMock);

    await expect(client.resolve("missing", NOW)).resolves.toEqual({ status: 404 });
    await expect(client.resolve("expired", NOW)).resolves.toEqual({ status: 404 });
    await expect(client.stats("missing", NOW)).resolves.toBeNull();
  });

  it("maps collisions, unavailable responses, and transport failures to typed errors", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: "alias_collision" }, 409))
      .mockResolvedValueOnce(jsonResponse({ error: "service_unavailable" }, 503))
      .mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));
    const client = makeClient(fetchMock);

    await expect(client.create({ destinationUrl: LINK.destinationUrl }, NOW)).rejects.toMatchObject({ code: "alias_collision" });
    await expect(client.deleteExpired(NOW)).rejects.toMatchObject({ code: "unavailable" });
    await expect(client.stats("docs", NOW)).rejects.toMatchObject({ code: "unavailable" });
  });

  it("keeps generic gateway failures unclassified and redacts sensitive values", async () => {
    const rawBody = "raw-secret-response";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(rawBody, { status: 500 }));
    const client = makeClient(fetchMock);

    const thrown = await client.create({ destinationUrl: LINK.destinationUrl }, NOW).catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(ShortLinkError);
    const rendered = String((thrown as Error).stack ?? thrown);
    expect(rendered).not.toContain("very-secret-token");
    expect(rendered).not.toContain(rawBody);
    expect(rendered).not.toContain(LINK.destinationUrl);
    expect(rendered).not.toContain("now=");
    expect(rendered).not.toContain("gateway.example.test/root/internal");
  });

  it.each([
    ["create", jsonResponse({ ...LINK, extra: true }, 201)],
    ["resolve", jsonResponse({ status: 302 })],
    ["stats", jsonResponse({ ...LINK, clickCount: -1 })],
    ["cleanup", jsonResponse({ deletedCount: -1 })],
    ["cleanup fraction", jsonResponse({ deletedCount: 1.5 })],
  ])("rejects malformed %s success payloads with unclassified errors", async (operation, response) => {
    const client = makeClient(vi.fn<typeof fetch>().mockResolvedValue(response));
    const promise = operation === "create"
      ? client.create({ destinationUrl: LINK.destinationUrl }, NOW)
      : operation === "resolve"
        ? client.resolve("docs", NOW)
        : operation === "stats"
          ? client.stats("docs", NOW)
          : client.deleteExpired(NOW);

    await expect(promise).rejects.toBeInstanceOf(Error);
    await expect(promise).rejects.not.toBeInstanceOf(ShortLinkError);
  });

  it("rejects gateway responses larger than 16 KiB without exposing their body", async () => {
    const rawBody = `raw-secret-${"x".repeat(16 * 1024)}`;
    const client = makeClient(vi.fn<typeof fetch>().mockResolvedValue(new Response(rawBody, { status: 200 })));

    const thrown = await client.stats("docs", NOW).catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(Error);
    expect(String((thrown as Error).stack ?? thrown)).not.toContain("raw-secret");
  });

  it("accepts only the exact health object", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ok: true }));
    const client = makeClient(fetchMock);
    await expect(client.probe()).resolves.toBe(true);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://gateway.example.test/root/internal/health",
    );
    expect(fetchMock.mock.calls[0][1]?.method).toBe("GET");
  });

  it.each([401, 403, 500, 502])("returns false for status %i", async (status) => {
    const client = makeClient(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ ok: true }, status)));
    await expect(client.probe()).resolves.toBe(false);
  });

  it.each([
    [{ ok: true, extra: 1 }],
    [{ ok: false }],
    [],
  ])("rejects health body %j", async (body) => {
    const client = makeClient(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body)));
    await expect(client.probe()).resolves.toBe(false);
  });

  it("returns false when the probe times out", async () => {
    const client = makeClient(vi.fn<typeof fetch>().mockRejectedValue(
      new DOMException("timed out", "TimeoutError"),
    ));
    await expect(client.probe()).resolves.toBe(false);
  });
});
