import { describe, expect, it, vi } from "vitest";
import { ShortLinkError, type ShortLinkRecord } from "../url-shortener.model";
import { LocalShortLinkBackend } from "./local-backend";
import { generateSlug } from "./slug";
import type { ShortLinkStore } from "./short-link-backend";
import { describeShortLinkStoreContract } from "./store-contract";

class MemoryShortLinkStore implements ShortLinkStore {
  readonly records = new Map<string, ShortLinkRecord>();
  deleteCalls: string[] = [];
  insertAttempts = 0;
  collisionsRemaining = 0;
  incrementResult: boolean | undefined;
  beforeIncrement?: () => void;
  closed = false;

  async findBySlug(slug: string): Promise<ShortLinkRecord | null> {
    return this.records.get(slug) ?? null;
  }

  async insert(record: ShortLinkRecord): Promise<boolean> {
    this.insertAttempts += 1;
    if (this.collisionsRemaining > 0) {
      this.collisionsRemaining -= 1;
      return false;
    }
    if (this.records.has(record.slug)) return false;
    this.records.set(record.slug, { ...record });
    return true;
  }

  async incrementClicksIfActive(
    recordId: string,
    slug: string,
    clickedAt: string,
  ): Promise<boolean> {
    this.beforeIncrement?.();
    if (this.incrementResult !== undefined) return this.incrementResult;
    const record = this.records.get(slug);
    if (!record || record.id !== recordId || record.expiresAt <= clickedAt) {
      return false;
    }
    this.records.set(slug, {
      ...record,
      clickCount: record.clickCount + 1,
      lastClickedAt: clickedAt,
    });
    return true;
  }

  async deleteExpired(now: string): Promise<number> {
    this.deleteCalls.push(now);
    let deleted = 0;
    for (const [slug, record] of this.records) {
      if (record.expiresAt <= now) {
        this.records.delete(slug);
        deleted += 1;
      }
    }
    return deleted;
  }

  close(): void {
    this.closed = true;
  }
}

const createdAt = new Date("2026-07-12T00:00:00.000Z");
const expiresAt = "2026-07-12T00:05:00.000Z";

function record(overrides: Partial<ShortLinkRecord> = {}): ShortLinkRecord {
  return {
    id: "record-id",
    slug: "docs",
    destinationUrl: "https://example.com/docs",
    createdAt: createdAt.toISOString(),
    expiresAt,
    clickCount: 0,
    lastClickedAt: null,
    ...overrides,
  };
}

describe("generateSlug", () => {
  it("generates seven unambiguous URL-safe characters", () => {
    const slug = generateSlug(() =>
      Uint8Array.from([0, 1, 2, 3, 4, 5, 31]),
    );

    expect(slug).toHaveLength(7);
    expect(slug).toMatch(/^[2-9a-hjkmnp-z]{7}$/);
  });

  it("skips bytes outside the unbiased range and requests replacements", () => {
    const requestedLengths: number[] = [];
    const byteChunks = [
      Uint8Array.from([248, 249, 0, 1, 2, 3, 4]),
      Uint8Array.from([5, 6]),
    ];

    const slug = generateSlug((length) => {
      requestedLengths.push(length);
      return byteChunks.shift() ?? new Uint8Array(length);
    });

    expect(slug).toBe("2345678");
    expect(requestedLengths).toEqual([7, 2]);
  });
});

describe("LocalShortLinkBackend", () => {
  it("computes the server-controlled TTL and normalizes a custom alias", async () => {
    const store = new MemoryShortLinkStore();
    const backend = new LocalShortLinkBackend(store, 300);

    const created = await backend.create(
      {
        destinationUrl: "https://example.com/docs",
        customAlias: "  My-Docs  ",
      },
      createdAt,
    );

    expect(created).toEqual({
      slug: "my-docs",
      destinationUrl: "https://example.com/docs",
      createdAt: "2026-07-12T00:00:00.000Z",
      expiresAt: "2026-07-12T00:05:00.000Z",
      clickCount: 0,
      lastClickedAt: null,
    });
    expect(store.records.get("my-docs")?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f-]{27}$/,
    );
  });

  it("creates a seven-character generated slug", async () => {
    const store = new MemoryShortLinkStore();
    const backend = new LocalShortLinkBackend(store, 300);

    const created = await backend.create(
      { destinationUrl: "https://example.com/docs" },
      createdAt,
    );

    expect(created.slug).toMatch(/^[2-9a-hjkmnp-z]{7}$/);
  });

  it("retries generated slug collisions up to eight total attempts", async () => {
    const store = new MemoryShortLinkStore();
    store.collisionsRemaining = 7;
    const backend = new LocalShortLinkBackend(store, 300);

    await expect(
      backend.create({ destinationUrl: "https://example.com/docs" }, createdAt),
    ).resolves.toMatchObject({ destinationUrl: "https://example.com/docs" });
    expect(store.insertAttempts).toBe(8);
  });

  it("throws a typed collision after eight generated attempts", async () => {
    const store = new MemoryShortLinkStore();
    store.collisionsRemaining = 8;
    const backend = new LocalShortLinkBackend(store, 300);

    const result = backend.create(
      { destinationUrl: "https://example.com/docs" },
      createdAt,
    );

    await expect(result).rejects.toBeInstanceOf(ShortLinkError);
    await expect(result).rejects.toMatchObject({ code: "alias_collision" });
    expect(store.insertAttempts).toBe(8);
  });

  it("throws a typed collision without retrying a custom alias", async () => {
    const store = new MemoryShortLinkStore();
    store.records.set("docs", record());
    const backend = new LocalShortLinkBackend(store, 300);

    const result = backend.create(
      { destinationUrl: "https://example.com/other", customAlias: "docs" },
      createdAt,
    );

    await expect(result).rejects.toBeInstanceOf(ShortLinkError);
    await expect(result).rejects.toMatchObject({ code: "alias_collision" });
    expect(store.insertAttempts).toBe(1);
  });

  it.each([
    { destinationUrl: "ftp://example.com/file" },
    { destinationUrl: "https://example.com", customAlias: "x" },
  ])("preserves typed validation failures for invalid input", async (input) => {
    const backend = new LocalShortLinkBackend(new MemoryShortLinkStore(), 300);

    const result = backend.create(input, createdAt);

    await expect(result).rejects.toBeInstanceOf(ShortLinkError);
    await expect(result).rejects.toEqual(
      expect.objectContaining<Partial<ShortLinkError>>({ code: "validation" }),
    );
  });

  it("redirects active links and atomically records the click", async () => {
    const store = new MemoryShortLinkStore();
    store.records.set("docs", record());
    const backend = new LocalShortLinkBackend(store, 300);
    const clickedAt = new Date("2026-07-12T00:04:59.999Z");

    await expect(backend.resolve("docs", clickedAt)).resolves.toEqual({
      status: 302,
      destinationUrl: "https://example.com/docs",
    });
    expect(store.records.get("docs")).toMatchObject({
      clickCount: 1,
      lastClickedAt: clickedAt.toISOString(),
    });
  });

  it("returns 404 when the atomic increment finds the link no longer active", async () => {
    const store = new MemoryShortLinkStore();
    store.records.set("docs", record());
    store.incrementResult = false;
    const backend = new LocalShortLinkBackend(store, 300);

    await expect(
      backend.resolve("docs", new Date("2026-07-12T00:04:59.999Z")),
    ).resolves.toEqual({ status: 404 });
  });

  it("does not increment a replacement record created under the same slug", async () => {
    const store = new MemoryShortLinkStore();
    store.records.set("docs", record());
    store.beforeIncrement = () => {
      store.beforeIncrement = undefined;
      store.records.set(
        "docs",
        record({
          id: "replacement-id",
          destinationUrl: "https://example.com/replacement",
        }),
      );
    };
    const backend = new LocalShortLinkBackend(store, 300);

    await expect(
      backend.resolve("docs", new Date("2026-07-12T00:04:59.999Z")),
    ).resolves.toEqual({ status: 404 });
    expect(store.records.get("docs")).toMatchObject({
      id: "replacement-id",
      clickCount: 0,
      lastClickedAt: null,
    });
  });

  it("treats the exact expiration boundary as missing and cleans it up", async () => {
    const store = new MemoryShortLinkStore();
    store.records.set("docs", record());
    const backend = new LocalShortLinkBackend(store, 300);
    const boundary = new Date(expiresAt);

    await expect(backend.resolve("docs", boundary)).resolves.toEqual({
      status: 404,
    });
    expect(store.deleteCalls).toEqual([expiresAt]);
    expect(store.records.has("docs")).toBe(false);
  });

  it("returns null statistics for an expired link and cleans it up", async () => {
    const store = new MemoryShortLinkStore();
    store.records.set("docs", record());
    const backend = new LocalShortLinkBackend(store, 300);

    await expect(backend.stats("docs", new Date(expiresAt))).resolves.toBeNull();
    expect(store.deleteCalls).toEqual([expiresAt]);
  });

  it("returns an explicit public statistics projection for an active link", async () => {
    const store = new MemoryShortLinkStore();
    store.records.set("docs", record({ id: "private-id", clickCount: 4 }));
    const backend = new LocalShortLinkBackend(store, 300);

    await expect(
      backend.stats("docs", new Date("2026-07-12T00:04:00.000Z")),
    ).resolves.toEqual({
      slug: "docs",
      destinationUrl: "https://example.com/docs",
      createdAt: "2026-07-12T00:00:00.000Z",
      expiresAt,
      clickCount: 4,
      lastClickedAt: null,
    });
  });

  it("performs idempotent bulk cleanup", async () => {
    const store = new MemoryShortLinkStore();
    store.records.set("docs", record());
    const backend = new LocalShortLinkBackend(store, 300);

    await expect(backend.deleteExpired(new Date(expiresAt))).resolves.toBe(1);
    await expect(backend.deleteExpired(new Date(expiresAt))).resolves.toBe(0);
  });

  it("closes a closeable store", async () => {
    const store = new MemoryShortLinkStore();
    const backend = new LocalShortLinkBackend(store, 300);

    await backend.close();

    expect(store.closed).toBe(true);
  });

  it.each([
    ["create", "insert"],
    ["resolve", "findBySlug"],
    ["stats", "findBySlug"],
    ["deleteExpired", "deleteExpired"],
  ] as const)(
    "rethrows unexpected %s store failures unchanged",
    async (operation, method) => {
      const store = new MemoryShortLinkStore();
      store.records.set("docs", record());
      const failure = new Error("database unavailable");
      vi.spyOn(store, method).mockRejectedValueOnce(failure);
      const backend = new LocalShortLinkBackend(store, 300);

      const result =
        operation === "create"
          ? backend.create({ destinationUrl: "https://example.com" }, createdAt)
          : operation === "resolve"
            ? backend.resolve("docs", createdAt)
            : operation === "stats"
              ? backend.stats("docs", createdAt)
              : backend.deleteExpired(createdAt);

      await expect(result).rejects.toBe(failure);
      await expect(result).rejects.not.toBeInstanceOf(ShortLinkError);
    },
  );
});

describeShortLinkStoreContract("MemoryShortLinkStore", async () =>
  new MemoryShortLinkStore(),
);
