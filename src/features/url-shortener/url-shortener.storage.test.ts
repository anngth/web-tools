import { beforeEach, describe, expect, it } from "vitest";
import {
  CREATED_LINKS_STORAGE_KEY,
  loadCreatedLinks,
  saveCreatedLinks,
} from "./url-shortener.storage";

const createdLink = {
  slug: "docs-42",
  destinationUrl: "https://example.com/reference",
  createdAt: "2026-07-12T10:00:00.000Z",
  expiresAt: "2026-08-11T10:00:00.000Z",
  clickCount: 3,
  lastClickedAt: "2026-07-13T10:00:00.000Z",
  shortUrl: "https://short.example/s/docs-42",
};

describe("created-link session storage", () => {
  beforeEach(() => sessionStorage.clear());

  it("round-trips only the allowed public fields", () => {
    saveCreatedLinks([createdLink]);

    expect(loadCreatedLinks()).toEqual([createdLink]);
    expect(JSON.parse(sessionStorage.getItem(CREATED_LINKS_STORAGE_KEY)!)).toEqual([
      createdLink,
    ]);
  });

  it("uses the supplied storage boundary", () => {
    const memory = new Map<string, string>();
    const storage: Storage = {
      get length() {
        return memory.size;
      },
      clear: () => memory.clear(),
      getItem: (key) => memory.get(key) ?? null,
      key: (index) => [...memory.keys()][index] ?? null,
      removeItem: (key) => void memory.delete(key),
      setItem: (key, value) => void memory.set(key, value),
    };

    saveCreatedLinks([createdLink], storage);
    expect(loadCreatedLinks(storage)).toEqual([createdLink]);
  });

  it.each([
    "not-json",
    JSON.stringify({ link: createdLink }),
    JSON.stringify([{ ...createdLink, deleteToken: "secret" }]),
    JSON.stringify([{ ...createdLink, clickCount: "3" }]),
    JSON.stringify([{ ...createdLink, lastClickedAt: false }]),
    JSON.stringify([{ ...createdLink, shortUrl: "javascript:alert(1)" }]),
    JSON.stringify([{ ...createdLink, shortUrl: "/s/docs-42" }]),
  ])("removes malformed or unsafe stored data", (value) => {
    sessionStorage.setItem(CREATED_LINKS_STORAGE_KEY, value);

    expect(loadCreatedLinks()).toEqual([]);
    expect(sessionStorage.getItem(CREATED_LINKS_STORAGE_KEY)).toBeNull();
  });

  it("does not persist extra fields passed at runtime", () => {
    saveCreatedLinks([{ ...createdLink, deleteToken: "secret" } as typeof createdLink]);

    expect(JSON.parse(sessionStorage.getItem(CREATED_LINKS_STORAGE_KEY)!)).toEqual([
      createdLink,
    ]);
  });

  it("returns an empty list when storage getItem throws", () => {
    const storage = {
      getItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    } as unknown as Storage;

    expect(loadCreatedLinks(storage)).toEqual([]);
  });

  it("returns an empty list when malformed-data cleanup throws", () => {
    const storage = {
      getItem: () => "not-json",
      removeItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    } as unknown as Storage;

    expect(loadCreatedLinks(storage)).toEqual([]);
  });

  it("treats storage setItem failures as best-effort persistence", () => {
    const storage = {
      setItem: () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
    } as unknown as Storage;

    expect(() => saveCreatedLinks([createdLink], storage)).not.toThrow();
  });
});
