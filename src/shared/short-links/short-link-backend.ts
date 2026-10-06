import type {
  CreateShortLinkInput,
  ShortLinkPublic,
  ShortLinkRecord,
  ShortLinkStats,
} from "./model";

export interface ShortLinkStore {
  findBySlug(slug: string): Promise<ShortLinkRecord | null>;
  insert(record: ShortLinkRecord): Promise<boolean>;
  incrementClicksIfActive(
    recordId: string,
    slug: string,
    clickedAt: string,
  ): Promise<boolean>;
  deleteExpired(now: string): Promise<number>;
  /** Counts records whose `expiresAt` is strictly after `now`. */
  countActive(now: string): Promise<number>;
  close?(): Promise<void> | void;
}

export interface ShortLinkBackend {
  create(input: CreateShortLinkInput, now?: Date): Promise<ShortLinkPublic>;
  resolve(
    slug: string,
    now?: Date,
  ): Promise<{ status: 302; destinationUrl: string } | { status: 404 }>;
  stats(slug: string, now?: Date): Promise<ShortLinkStats | null>;
  deleteExpired(now?: Date): Promise<number>;
  close?(): Promise<void> | void;
}
