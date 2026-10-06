import { describe, expect, it } from "vitest";
import type { ShortLinkRecord } from "./model";
import type { ShortLinkStore } from "./short-link-backend";

type StoreFactory = () => Promise<ShortLinkStore> | ShortLinkStore;

function record(
  slug: string,
  expiresAt = "2026-07-12T00:05:00.000Z",
): ShortLinkRecord {
  return {
    id: `id-${slug}`,
    slug,
    destinationUrl: `https://example.com/${slug}`,
    createdAt: "2026-07-12T00:00:00.000Z",
    expiresAt,
    clickCount: 0,
    lastClickedAt: null,
  };
}

export function describeShortLinkStoreContract(
  name: string,
  createStore: StoreFactory,
): void {
  describe(`${name} short-link store contract`, () => {
    it("inserts and reads a record", async () => {
      const store = await createStore();
      const expected = record("docs");

      await expect(store.insert(expected)).resolves.toBe(true);
      await expect(store.findBySlug("docs")).resolves.toEqual(expected);

      await store.close?.();
    });

    it("reports a unique slug collision", async () => {
      const store = await createStore();
      const sameSlugWithDifferentId = {
        ...record("docs"),
        id: "different-record-id",
      };

      await expect(store.insert(record("docs"))).resolves.toBe(true);
      await expect(store.insert(sameSlugWithDifferentId)).resolves.toBe(false);

      await store.close?.();
    });

    it("conditionally increments an active record", async () => {
      const store = await createStore();
      await store.insert(record("docs"));
      const clickedAt = "2026-07-12T00:04:59.999Z";

      await expect(
        store.incrementClicksIfActive("id-docs", "docs", clickedAt),
      ).resolves.toBe(true);
      await expect(store.findBySlug("docs")).resolves.toMatchObject({
        clickCount: 1,
        lastClickedAt: clickedAt,
      });

      await store.close?.();
    });

    it("counts only records that expire strictly after now", async () => {
      const store = await createStore();
      await store.insert(record("active", "2026-07-12T00:05:00.000Z"));
      await store.insert(record("boundary", "2026-07-12T00:02:00.000Z"));
      await store.insert(record("expired", "2026-07-12T00:01:00.000Z"));

      await expect(store.countActive("2026-07-12T00:00:00.000Z")).resolves.toBe(3);
      await expect(store.countActive("2026-07-12T00:01:00.000Z")).resolves.toBe(2);
      await expect(store.countActive("2026-07-12T00:02:00.000Z")).resolves.toBe(1);
      await expect(store.countActive("2026-07-12T00:05:00.000Z")).resolves.toBe(0);

      await store.close?.();
    });

    it("does not increment at the exact expiration boundary", async () => {
      const store = await createStore();
      await store.insert(record("docs"));

      await expect(
        store.incrementClicksIfActive(
          "id-docs",
          "docs",
          "2026-07-12T00:05:00.000Z",
        ),
      ).resolves.toBe(false);
      await expect(store.findBySlug("docs")).resolves.toMatchObject({
        clickCount: 0,
        lastClickedAt: null,
      });

      await store.close?.();
    });

    it("does not increment a different record that reused the slug", async () => {
      const store = await createStore();
      await store.insert(record("docs"));

      await expect(
        store.incrementClicksIfActive(
          "different-record-id",
          "docs",
          "2026-07-12T00:04:59.999Z",
        ),
      ).resolves.toBe(false);
      await expect(store.findBySlug("docs")).resolves.toMatchObject({
        id: "id-docs",
        clickCount: 0,
        lastClickedAt: null,
      });

      await store.close?.();
    });

    it("returns cleanup row counts and makes repeated cleanup idempotent", async () => {
      const store = await createStore();
      await store.insert(record("expired", "2026-07-12T00:05:00.000Z"));
      await store.insert(record("active", "2026-07-12T00:05:00.001Z"));

      await expect(
        store.deleteExpired("2026-07-12T00:05:00.000Z"),
      ).resolves.toBe(1);
      await expect(
        store.deleteExpired("2026-07-12T00:05:00.000Z"),
      ).resolves.toBe(0);
      await expect(store.findBySlug("expired")).resolves.toBeNull();
      await expect(store.findBySlug("active")).resolves.not.toBeNull();

      await store.close?.();
    });

    it("supports optional close behavior", async () => {
      const store = await createStore();

      await expect(Promise.resolve(store.close?.())).resolves.toBeUndefined();
    });
  });
}
