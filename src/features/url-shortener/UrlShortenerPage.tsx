import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowDown, Check, Clipboard, RefreshCw } from "lucide-react";
import { copyTextToClipboard } from "../../shared/clipboard";
import type { CreatedShortLink, ShortLinkStats } from "./url-shortener.model";
import {
  UrlShortenerApiError,
  createShortLink,
  getShortLinkStats,
} from "./url-shortener.api";
import { loadCreatedLinks, saveCreatedLinks } from "./url-shortener.storage";
import "./url-shortener.css";

function formatDate(value: string): string {
  const date = new Date(value);
  if (date.getTime() <= Date.now()) return "Expired";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatLastClick(value: string | null): string {
  if (value === null) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

type LinkIdentity = Pick<CreatedShortLink, "slug" | "createdAt">;

function identityKey(identity: LinkIdentity): string {
  return `${identity.slug}\u0000${identity.createdAt}`;
}

function hasIdentity(link: CreatedShortLink, identity: LinkIdentity): boolean {
  return link.slug === identity.slug && link.createdAt === identity.createdAt;
}

export function UrlShortenerPage() {
  const [destinationUrl, setDestinationUrl] = useState("");
  const [customAlias, setCustomAlias] = useState("");
  const [links, setLinks] = useState<CreatedShortLink[]>(loadCreatedLinks);
  const linksRef = useRef(links);
  const initialLinksRef = useRef(links);
  const destinationInputRef = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState(false);
  const refreshingLinksRef = useRef<Set<string>>(new Set());
  const [refreshingLinks, setRefreshingLinks] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);
  const [error, setError] = useState("");

  function replaceLinks(
    update: (current: CreatedShortLink[]) => CreatedShortLink[],
  ) {
    const next = update(linksRef.current);
    linksRef.current = next;
    saveCreatedLinks(next);
    setLinks(next);
  }

  function mergeStats(identity: LinkIdentity, stats: ShortLinkStats) {
    if (stats.slug !== identity.slug || stats.createdAt !== identity.createdAt) {
      return;
    }
    replaceLinks((current) =>
      current.map((link) =>
        hasIdentity(link, identity)
          ? { ...stats, shortUrl: link.shortUrl }
          : link,
      ),
    );
  }

  function removeMissingLink(identity: LinkIdentity) {
    if (!linksRef.current.some((link) => hasIdentity(link, identity))) return;
    replaceLinks((current) =>
      current.filter((link) => !hasIdentity(link, identity)),
    );
    setError("The saved short link expired or no longer exists. Create a new one.");
  }

  function startRefreshing(identity: LinkIdentity): boolean {
    const key = identityKey(identity);
    if (refreshingLinksRef.current.has(key)) return false;
    const next = new Set(refreshingLinksRef.current);
    next.add(key);
    refreshingLinksRef.current = next;
    setRefreshingLinks(next);
    return true;
  }

  function finishRefreshing(identity: LinkIdentity) {
    const next = new Set(refreshingLinksRef.current);
    next.delete(identityKey(identity));
    refreshingLinksRef.current = next;
    setRefreshingLinks(next);
  }

  async function refreshStats(identity: LinkIdentity) {
    if (!startRefreshing(identity)) return;
    setError("");
    try {
      mergeStats(identity, await getShortLinkStats(identity.slug));
    } catch (reason) {
      if (reason instanceof UrlShortenerApiError && reason.status === 404) {
        removeMissingLink(identity);
      } else {
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not refresh statistics. Try again.",
        );
      }
    } finally {
      finishRefreshing(identity);
    }
  }

  useEffect(() => {
    for (const link of initialLinksRef.current) {
      void refreshStats(link);
    }
    // Rehydration refreshes only the links present on initial mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setCopiedSlug(null);
    setError("");

    const input = {
      destinationUrl: destinationUrl.trim(),
      ...(customAlias.trim() ? { customAlias: customAlias.trim() } : {}),
    };

    try {
      const created = await createShortLink(input);
      replaceLinks((current) => [
        created,
        ...current.filter((link) => link.slug !== created.slug),
      ]);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not create the short link. Check the destination and try again.",
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleCopy(link: CreatedShortLink) {
    setCopiedSlug(null);
    setError("");
    if (await copyTextToClipboard(link.shortUrl)) {
      setCopiedSlug(link.slug);
      return;
    }
    setError(
      "Could not copy the short URL. Check clipboard permission and try again.",
    );
  }

  function clearForm() {
    setDestinationUrl("");
    setCustomAlias("");
    setCopiedSlug(null);
    setError("");
    destinationInputRef.current?.focus();
  }

  return (
    <div className="panel urlShortener">
      <form
        className="urlShortenerForm"
        aria-label="Create short link"
        onSubmit={handleCreate}
      >
        <label className="field" htmlFor="short-link-destination">
          <span>Destination URL</span>
          <input
            ref={destinationInputRef}
            id="short-link-destination"
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoComplete="url"
            autoCorrect="off"
            spellCheck="false"
            placeholder="https://example.com/a/long/destination"
            required
            value={destinationUrl}
            aria-describedby="short-link-help short-link-error"
            onChange={(event) => setDestinationUrl(event.target.value)}
          />
        </label>
        <label className="field" htmlFor="short-link-alias">
          <span>Custom alias (optional)</span>
          <input
            id="short-link-alias"
            type="text"
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            spellCheck="false"
            placeholder="release-notes"
            value={customAlias}
            aria-describedby="short-link-help short-link-error"
            onChange={(event) => setCustomAlias(event.target.value)}
          />
        </label>
        <p id="short-link-help" className="helpText urlShortenerHelp">
          Links expire automatically. Use 3–48 lowercase letters, numbers, or
          hyphens for an alias.
        </p>
        <p
          id="short-link-error"
          className={error ? "errorText" : "errorText isHidden"}
          role="alert"
          aria-live="polite"
        >
          {error || " "}
        </p>
        <div className="urlShortenerFormActions">
          <button className="urlShortenerPrimary" type="submit" disabled={creating}>
            {creating ? "Creating…" : "Create short link"}
          </button>
          <button
            className="urlShortenerSecondary"
            type="button"
            onClick={clearForm}
            disabled={creating || (!destinationUrl && !customAlias)}
          >
            Clear form
          </button>
        </div>
      </form>

      {links.length > 0 && (
        <section className="urlShortenerResults" aria-labelledby="created-links-heading">
          <h2 id="created-links-heading">Created this session</h2>
          <div className="urlShortenerResultList">
            {links.map((link) => {
              const isRefreshing = refreshingLinks.has(identityKey(link));
              const isCopied = copiedSlug === link.slug;
              return (
                <article
                  key={identityKey(link)}
                  className="urlShortenerRelay"
                  aria-label={`Short link ${link.slug}`}
                >
                  <div className="urlShortenerRoute">
                    <span className="urlShortenerRouteLabel">Destination</span>
                    <span className="urlShortenerDestination" title={link.destinationUrl}>
                      {link.destinationUrl}
                    </span>
                    <ArrowDown className="urlShortenerRelayArrow" size={18} aria-hidden />
                    <span className="urlShortenerRouteLabel">Short route</span>
                    <strong className="urlShortenerShortUrl">{link.shortUrl}</strong>
                  </div>
                  <button
                    className={
                      isCopied
                        ? "urlShortenerCopy isCopied"
                        : "urlShortenerCopy"
                    }
                    type="button"
                    onClick={() => void handleCopy(link)}
                  >
                    {isCopied ? <Check size={17} /> : <Clipboard size={17} />}
                    {isCopied ? "Copied" : "Copy short URL"}
                  </button>

                  <dl className="urlShortenerStats">
                    <div>
                      <dt>Clicks</dt>
                      <dd>{link.clickCount}</dd>
                    </div>
                    <div>
                      <dt>Expires</dt>
                      <dd>
                        <time dateTime={link.expiresAt}>{formatDate(link.expiresAt)}</time>
                      </dd>
                    </div>
                    <div>
                      <dt>Last click</dt>
                      <dd>{formatLastClick(link.lastClickedAt)}</dd>
                    </div>
                  </dl>

                  <button
                    className="urlShortenerRefresh"
                    type="button"
                    disabled={isRefreshing}
                    onClick={() => void refreshStats(link)}
                  >
                    <RefreshCw size={16} aria-hidden />
                    {isRefreshing ? "Refreshing…" : "Refresh statistics"}
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
