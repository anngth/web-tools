import type { CreatedShortLink } from "../../shared/short-links/model.ts";
import { isCreatedShortLink } from "./url-shortener.api";

export const CREATED_LINKS_STORAGE_KEY =
  "web-tools:url-shortener:created-links:v1";

function currentStorage(storage?: Storage): Storage {
  return storage ?? window.sessionStorage;
}

function publicFields(link: CreatedShortLink): CreatedShortLink {
  return {
    slug: link.slug,
    destinationUrl: link.destinationUrl,
    createdAt: link.createdAt,
    expiresAt: link.expiresAt,
    clickCount: link.clickCount,
    lastClickedAt: link.lastClickedAt,
    shortUrl: link.shortUrl,
  };
}

export function loadCreatedLinks(storage?: Storage): CreatedShortLink[] {
  let target: Storage | undefined;

  try {
    target = currentStorage(storage);
    const stored = target.getItem(CREATED_LINKS_STORAGE_KEY);
    if (stored === null) return [];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed) || !parsed.every(isCreatedShortLink)) {
      throw new Error("Invalid stored links");
    }
    return parsed;
  } catch {
    try {
      target?.removeItem(CREATED_LINKS_STORAGE_KEY);
    } catch {
      // Session storage is best-effort and may be unavailable or blocked.
    }
    return [];
  }
}

export function saveCreatedLinks(
  links: CreatedShortLink[],
  storage?: Storage,
): void {
  try {
    const target = currentStorage(storage);
    const safeLinks = links.map(publicFields).filter(isCreatedShortLink);
    target.setItem(CREATED_LINKS_STORAGE_KEY, JSON.stringify(safeLinks));
  } catch {
    // UI state remains usable when session storage is unavailable or full.
  }
}
