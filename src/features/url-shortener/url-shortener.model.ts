export interface CreateShortLinkInput {
  destinationUrl: string;
  customAlias?: string;
}

export interface ShortLinkRecord {
  id: string;
  slug: string;
  destinationUrl: string;
  createdAt: string;
  expiresAt: string;
  clickCount: number;
  lastClickedAt: string | null;
}

export type ShortLinkStats = Pick<
  ShortLinkRecord,
  | "slug"
  | "destinationUrl"
  | "createdAt"
  | "expiresAt"
  | "clickCount"
  | "lastClickedAt"
>;

export type ShortLinkPublic = ShortLinkStats;

export interface CreatedShortLink extends ShortLinkStats {
  shortUrl: string;
}

export type ShortLinkErrorCode =
  | "validation"
  | "alias_collision"
  | "capacity"
  | "unavailable";

export class ShortLinkError extends Error {
  readonly code: ShortLinkErrorCode;

  constructor(code: ShortLinkErrorCode) {
    super("Short link operation failed");
    this.code = code;
  }
}

export function isShortLinkError(
  value: unknown,
  code?: ShortLinkErrorCode,
): value is ShortLinkError {
  return (
    value instanceof ShortLinkError &&
    (code === undefined || value.code === code)
  );
}
