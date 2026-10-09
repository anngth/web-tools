import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowDown, Check, Clipboard, RefreshCw } from "lucide-react";
import { copyTextToClipboard } from "../../shared/clipboard";
import type { CreatedShortLink, ShortLinkStats } from "../../shared/short-links/model.ts";
import {
  UrlShortenerApiError,
  checkShortLinkService,
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

const COPY_FEEDBACK_MS = 2_000;

type CopyField = "destination" | "short";

function copiedFieldKey(slug: string, field: CopyField): string {
  return `${field}\u0000${slug}`;
}

type LinkIdentity = Pick<CreatedShortLink, "slug" | "createdAt">;

function identityKey(identity: LinkIdentity): string {
  return `${identity.slug}\u0000${identity.createdAt}`;
}

function hasIdentity(link: CreatedShortLink, identity: LinkIdentity): boolean {
  return link.slug === identity.slug && link.createdAt === identity.createdAt;
}

function CopyableUrl({
  url,
  copied,
  onCopy,
  rowClassName,
  textClassName,
}: {
  url: string;
  copied: boolean;
  onCopy: () => void;
  rowClassName: string;
  textClassName: string;
}) {
  return (
    <div className={copied ? `${rowClassName} isCopied` : rowClassName}>
      <a
        className={textClassName}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        title={url}
      >
        {url}
      </a>
      <button
        className="urlShortenerCopyButton"
        type="button"
        aria-label={copied ? `Copied ${url}` : `Copy ${url}`}
        onClick={onCopy}
      >
        {copied ? <Check size={20} aria-hidden /> : <Clipboard size={20} aria-hidden />}
      </button>
    </div>
  );
}

export function UrlShortenerPage() {
  const [destinationUrl, setDestinationUrl] = useState("");
  const [customAlias, setCustomAlias] = useState("");
  const [links, setLinks] = useState<CreatedShortLink[]>(loadCreatedLinks);
  const linksRef = useRef(links);
  const destinationInputRef = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState(false);
  const refreshingLinksRef = useRef<Set<string>>(new Set());
  const [refreshingLinks, setRefreshingLinks] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copiedResetTimeoutRef = useRef<number | null>(null);
  const [error, setError] = useState("");
  const [serviceState, setServiceState] = useState<
    "checking" | "unavailable" | "ready"
  >("checking");

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

  async function probeService() {
    setServiceState("checking");
    try {
      await checkShortLinkService();
      setServiceState("ready");
    } catch {
      setServiceState("unavailable");
    }
  }

  useEffect(() => {
    void probeService();
    // The first probe runs once when the tab opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (serviceState !== "ready") return;
    for (const link of linksRef.current) {
      void refreshStats(link);
    }
    // Statistics refresh only after a successful probe, including Retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceState]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    clearCopiedFeedback();
    setCopiedKey(null);
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

  function clearCopiedFeedback() {
    if (copiedResetTimeoutRef.current !== null) {
      window.clearTimeout(copiedResetTimeoutRef.current);
      copiedResetTimeoutRef.current = null;
    }
  }

  useEffect(() => clearCopiedFeedback, []);

  async function handleCopy(link: CreatedShortLink, field: CopyField) {
    const value = field === "short" ? link.shortUrl : link.destinationUrl;
    const key = copiedFieldKey(link.slug, field);
    clearCopiedFeedback();
    setCopiedKey(null);
    setError("");
    if (await copyTextToClipboard(value)) {
      setCopiedKey(key);
      copiedResetTimeoutRef.current = window.setTimeout(() => {
        copiedResetTimeoutRef.current = null;
        setCopiedKey((current) => (current === key ? null : current));
      }, COPY_FEEDBACK_MS);
      return;
    }
    setError(
      field === "short"
        ? "Could not copy the short URL. Check clipboard permission and try again."
        : "Could not copy the destination URL. Check clipboard permission and try again.",
    );
  }

  function clearForm() {
    setDestinationUrl("");
    setCustomAlias("");
    clearCopiedFeedback();
    setCopiedKey(null);
    setError("");
    destinationInputRef.current?.focus();
  }

  const showSession =
    serviceState === "ready" || links.length > 0;

  return (
    <div className="urlShortener">
      {serviceState !== "ready" && (
        <section className="panel urlShortenerNotice" role="status">
          <p>
            {serviceState === "checking"
              ? "Checking the short-link service…"
              : "The short-link service is not running."}
          </p>
          {serviceState === "unavailable" && (
            <button
              className="urlShortenerSecondary"
              type="button"
              onClick={() => void probeService()}
            >
              Retry
            </button>
          )}
        </section>
      )}
      <div className="urlShortenerWorkspace">
        {serviceState === "ready" && (
          <div className="panel urlShortenerComposer">
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
            <ul id="short-link-help" className="urlShortenerFacts">
              <li>Links expire automatically.</li>
              <li>Use 3–48 lowercase letters, numbers, or hyphens for an alias.</li>
              <li>Click statistics stay with each link.</li>
            </ul>
          </div>
        )}

        {showSession && (
          <section className="panel urlShortenerResults" aria-labelledby="created-links-heading">
            <h2 id="created-links-heading">Created this session</h2>
            {links.length === 0 ? (
              <p className="urlShortenerEmpty">
                Links you create in this session show up here.
              </p>
            ) : (
              <div className="urlShortenerResultList">
                {links.map((link) => {
                  const isRefreshing = refreshingLinks.has(identityKey(link));
                  const destinationCopied =
                    copiedKey === copiedFieldKey(link.slug, "destination");
                  const shortCopied = copiedKey === copiedFieldKey(link.slug, "short");
                  return (
                    <article
                      key={identityKey(link)}
                      className="urlShortenerRelay"
                      aria-label={`Short link ${link.slug}`}
                    >
                      <div className="urlShortenerLinkMain">
                        <div className="urlShortenerRoute">
                          <CopyableUrl
                            url={link.destinationUrl}
                            copied={destinationCopied}
                            onCopy={() => void handleCopy(link, "destination")}
                            rowClassName="urlShortenerCopy urlShortenerDestinationCopy"
                            textClassName="urlShortenerDestination"
                          />
                          <ArrowDown
                            className="urlShortenerRelayArrow"
                            size={28}
                            aria-hidden
                          />
                          <CopyableUrl
                            url={link.shortUrl}
                            copied={shortCopied}
                            onCopy={() => void handleCopy(link, "short")}
                            rowClassName="urlShortenerCopy"
                            textClassName="urlShortenerShortUrl"
                          />
                        </div>
                        <div className="urlShortenerLinkActions">
                          <button
                            className="urlShortenerRefresh"
                            type="button"
                            disabled={isRefreshing || serviceState !== "ready"}
                            onClick={() => void refreshStats(link)}
                          >
                            <RefreshCw size={16} aria-hidden />
                            {isRefreshing ? "Refreshing…" : "Refresh statistics"}
                          </button>
                        </div>
                      </div>

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
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
