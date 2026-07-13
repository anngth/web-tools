import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { ShortLinkRecord } from "../url-shortener.model";
import { D1ShortLinkStore } from "./d1-store";
import { describeShortLinkStoreContract } from "./store-contract";

describeShortLinkStoreContract("D1", () => new D1ShortLinkStore(env.DB));

describe("D1ShortLinkStore", () => {
  it("uses D1 success metadata to report a slug conflict without an exception", async () => {
    const run = async () => ({ meta: { changes: 0 } });
    const bind = () => ({ run });
    const database = {
      prepare: () => ({ bind }),
    } as unknown as D1Database;
    const store = new D1ShortLinkStore(database);

    await expect(
      store.insert({
        id: "new-id",
        slug: "existing",
        destinationUrl: "https://example.com",
        createdAt: "2026-07-12T00:00:00.000Z",
        expiresAt: "2026-07-12T00:05:00.000Z",
        clickCount: 0,
        lastClickedAt: null,
      }),
    ).resolves.toBe(false);
  });

  it("does not classify a primary-key conflict as a slug collision", async () => {
    const store = new D1ShortLinkStore(env.DB);
    const first: ShortLinkRecord = {
      id: "same-id",
      slug: "first",
      destinationUrl: "https://example.com/first",
      createdAt: "2026-07-12T00:00:00.000Z",
      expiresAt: "2026-07-12T00:05:00.000Z",
      clickCount: 0,
      lastClickedAt: null,
    };

    await store.insert(first);

    await expect(
      store.insert({ ...first, slug: "second" }),
    ).rejects.toBeInstanceOf(Error);
  });
});
