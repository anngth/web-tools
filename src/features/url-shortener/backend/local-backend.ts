import {
  ShortLinkError,
  type CreateShortLinkInput,
  type ShortLinkPublic,
  type ShortLinkRecord,
  type ShortLinkStats,
} from "../url-shortener.model";
import {
  computeExpiresAt,
  isExpired,
  validateCustomAlias,
  validateDestinationUrl,
} from "../url-shortener.validation";
import { generateSlug } from "./slug";
import type { ShortLinkBackend, ShortLinkStore } from "./short-link-backend";

const GENERATED_SLUG_ATTEMPTS = 8;

function toPublic(record: ShortLinkRecord): ShortLinkPublic {
  return {
    slug: record.slug,
    destinationUrl: record.destinationUrl,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    clickCount: record.clickCount,
    lastClickedAt: record.lastClickedAt,
  };
}

export class LocalShortLinkBackend implements ShortLinkBackend {
  constructor(
    private readonly store: ShortLinkStore,
    private readonly ttlSeconds: number,
    private readonly maxActiveLinks?: number,
  ) {}

  /** Serializes creations so the cap check and insert are one critical section. */
  private createQueue: Promise<unknown> = Promise.resolve();

  create(
    input: CreateShortLinkInput,
    now = new Date(),
  ): Promise<ShortLinkPublic> {
    const result = this.createQueue.then(() => this.createSerialized(input, now));
    this.createQueue = result.catch(() => undefined);
    return result;
  }

  private async createSerialized(
    input: CreateShortLinkInput,
    now: Date,
  ): Promise<ShortLinkPublic> {
    const destinationUrl = validateDestinationUrl(input.destinationUrl);
    const customAlias = validateCustomAlias(input.customAlias);
    const createdAt = now.toISOString();
    const expiresAt = computeExpiresAt(now, this.ttlSeconds);

    if (
      this.maxActiveLinks !== undefined &&
      (await this.store.countActive(createdAt)) >= this.maxActiveLinks
    ) {
      throw new ShortLinkError("capacity");
    }

    const attempts = customAlias === undefined ? GENERATED_SLUG_ATTEMPTS : 1;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const record: ShortLinkRecord = {
        id: crypto.randomUUID(),
        slug: customAlias ?? generateSlug(),
        destinationUrl,
        createdAt,
        expiresAt,
        clickCount: 0,
        lastClickedAt: null,
      };

      if (await this.store.insert(record)) return toPublic(record);
    }

    throw new ShortLinkError("alias_collision");
  }

  async resolve(
    slug: string,
    now = new Date(),
  ): Promise<{ status: 302; destinationUrl: string } | { status: 404 }> {
    const nowIso = now.toISOString();
    const record = await this.store.findBySlug(slug);
    if (!record) return { status: 404 };

    if (isExpired(record.expiresAt, now)) {
      await this.store.deleteExpired(nowIso);
      return { status: 404 };
    }

    if (!(await this.store.incrementClicksIfActive(record.id, slug, nowIso))) {
      return { status: 404 };
    }

    return { status: 302, destinationUrl: record.destinationUrl };
  }

  async stats(slug: string, now = new Date()): Promise<ShortLinkStats | null> {
    const nowIso = now.toISOString();
    const record = await this.store.findBySlug(slug);
    if (!record) return null;

    if (isExpired(record.expiresAt, now)) {
      await this.store.deleteExpired(nowIso);
      return null;
    }

    return toPublic(record);
  }

  deleteExpired(now = new Date()): Promise<number> {
    return this.store.deleteExpired(now.toISOString());
  }

  async close(): Promise<void> {
    await this.store.close?.();
  }
}
