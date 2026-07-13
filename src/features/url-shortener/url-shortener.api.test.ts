import { afterEach, describe, expect, it, vi } from "vitest";
import {
  UrlShortenerApiError,
  createShortLink,
  getShortLinkStats,
} from "./url-shortener.api";

const createdLink = {
  slug: "docs-42",
  destinationUrl: "https://example.com/reference",
  createdAt: "2026-07-12T10:00:00.000Z",
  expiresAt: "2026-08-11T10:00:00.000Z",
  clickCount: 0,
  lastClickedAt: null,
  shortUrl: "https://short.example/s/docs-42",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("url shortener API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts only the destination when no alias is supplied", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(createdLink, 201));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createShortLink({ destinationUrl: createdLink.destinationUrl }),
    ).resolves.toEqual(createdLink);
    expect(fetchMock).toHaveBeenCalledWith("/api/links", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ destinationUrl: createdLink.destinationUrl }),
    });
  });

  it("includes a non-empty optional alias and no other fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(createdLink, 201));
    vi.stubGlobal("fetch", fetchMock);

    await createShortLink({
      destinationUrl: createdLink.destinationUrl,
      customAlias: "docs-42",
    });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      destinationUrl: createdLink.destinationUrl,
      customAlias: "docs-42",
    });
  });

  it("uses an encoded same-origin stats path and accepts the exact flat schema", async () => {
    const { shortUrl: _shortUrl, ...stats } = createdLink;
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(stats));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getShortLinkStats("docs/42")).resolves.toEqual(stats);
    expect(fetchMock).toHaveBeenCalledWith("/api/links/docs%2F42/stats", {
      headers: { accept: "application/json" },
    });
  });

  it.each([
    { data: createdLink },
    { link: createdLink },
    { ...createdLink, deleteToken: "secret" },
    { ...createdLink, clickCount: -1 },
    { ...createdLink, shortUrl: "javascript:alert(1)" },
  ])("rejects an invalid create success body without returning its data", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(body, 201)));

    await expect(
      createShortLink({ destinationUrl: createdLink.destinationUrl }),
    ).rejects.toMatchObject({
      name: "UrlShortenerApiError",
      code: "invalid_response",
      message: "The short-link service returned an invalid response. Try again.",
    });
  });

  it.each([
    { data: createdLink },
    { link: createdLink },
    createdLink,
    { ...createdLink, shortUrl: null },
  ])("rejects wrappers and non-exact statistics bodies", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(body)));

    await expect(getShortLinkStats("docs-42")).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("rejects malformed success JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("not-json", { status: 201 })),
    );

    await expect(
      createShortLink({ destinationUrl: createdLink.destinationUrl }),
    ).rejects.toBeInstanceOf(UrlShortenerApiError);
  });

  it.each([
    ["create", 200],
    ["stats", 201],
  ])("rejects a valid %s body with the wrong success status", async (operation, status) => {
    const { shortUrl: _shortUrl, ...stats } = createdLink;
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(jsonResponse(operation === "create" ? createdLink : stats, status)),
    );

    const request =
      operation === "create"
        ? createShortLink({ destinationUrl: createdLink.destinationUrl })
        : getShortLinkStats(createdLink.slug);
    await expect(request).rejects.toMatchObject({ code: "invalid_response", status });
  });

  it.each([
    [400, "invalid_request", "Check the destination URL and custom alias, then try again."],
    [404, "not_found", "This short link is missing or has expired."],
    [409, "alias_collision", "That custom alias is already in use. Choose another alias."],
    [413, "invalid_request", "The request is too large. Shorten the destination URL or alias, then try again."],
    [429, "rate_limited", "Too many links were created. Wait a moment, then try again."],
    [500, "internal_error", "The short-link service could not complete the request. Try again."],
    [503, "service_unavailable", "The short-link service is temporarily unavailable. Try again."],
  ])("maps %i errors to a friendly typed error", async (status, code, message) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: code, detail: "raw secret" }, status)),
    );

    const error = await createShortLink({
      destinationUrl: createdLink.destinationUrl,
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(UrlShortenerApiError);
    expect(error).toMatchObject({ status, code, message });
    expect(String(error)).not.toContain("raw secret");
  });

  it("does not read or expose a 413 response body", async () => {
    const response = new Response("sensitive raw request body", { status: 413 });
    const json = vi.spyOn(response, "json");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    await expect(
      createShortLink({ destinationUrl: createdLink.destinationUrl }),
    ).rejects.toMatchObject({
      code: "invalid_request",
      status: 413,
      message:
        "The request is too large. Shorten the destination URL or alias, then try again.",
    });
    expect(json).not.toHaveBeenCalled();
  });
});
