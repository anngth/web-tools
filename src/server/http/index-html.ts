import { fallbackToolId } from "../../app/disabledTools";
import {
  DEFAULT_SEO_TOOL_ID,
  seoToolIdFromPathname,
  toolSeoData,
  type SeoToolId,
} from "../../app/toolSeoData";

export const SITE_ORIGIN_PLACEHOLDER = "__SITE_ORIGIN__";

const TITLE = /<title>[^<]*<\/title>/;
const DESCRIPTION = /(<meta\s+name="description"\s+content=")[^"]*(")/;
const CANONICAL = /(<link\s+rel="canonical"\s+href=")[^"]*(")/;
const JSON_LD = /<script type="application\/ld\+json">[\s\S]*?<\/script>/;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Renders the SPA shell for a request path so crawlers that do not run
 * JavaScript still see the title, description, canonical URL and structured
 * data of the tool the path belongs to. Disabled tools resolve to the fallback
 * tool, and their ids are published in a meta tag the app reads to hide them
 * (a meta tag, because the CSP blocks inline scripts).
 */
export function renderIndexHtml(
  source: string,
  origin: string,
  pathname: string,
  disabled: ReadonlySet<SeoToolId> = new Set(),
): string {
  const requested = seoToolIdFromPathname(pathname);
  const toolId = disabled.has(requested) ? fallbackToolId(disabled) : requested;
  const seo = toolSeoData[toolId];
  const url = `${SITE_ORIGIN_PLACEHOLDER}/${toolId}`;

  let html = source
    .replace(TITLE, () => `<title>${escapeHtml(seo.title)}</title>`)
    .replace(
      DESCRIPTION,
      (_match, open: string, close: string) =>
        `${open}${escapeHtml(seo.description)}${close}`,
    )
    .replace(
      CANONICAL,
      (_match, open: string, close: string) => `${open}${url}${close}`,
    );

  if (toolId !== DEFAULT_SEO_TOOL_ID) {
    const structuredData = JSON.stringify(
      {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        ...seo.structuredData,
        url,
        operatingSystem: "Any",
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      },
      null,
      2,
    ).replace(/</g, "\\u003c");
    html = html.replace(
      JSON_LD,
      () =>
        `<script type="application/ld+json">\n${structuredData}\n    </script>`,
    );
  }

  if (disabled.size > 0) {
    const meta = `<meta name="disabled-tools" content="${escapeHtml([...disabled].join(","))}" />\n  </head>`;
    html = html.replace("</head>", () => meta);
  }

  return renderSiteOrigin(html, origin);
}

const SITEMAP_ENTRY = /\s*<url>[\s\S]*?<\/url>/g;
const SITEMAP_LOC = /<loc>[^<]*\/([^/<]+)<\/loc>/;

/** Drops the sitemap entries of disabled tools. */
export function renderSitemap(
  source: string,
  disabled: ReadonlySet<SeoToolId>,
): string {
  if (disabled.size === 0) return source;
  return source.replace(SITEMAP_ENTRY, (entry) => {
    const id = SITEMAP_LOC.exec(entry)?.[1];
    return id !== undefined && disabled.has(id as SeoToolId) ? "" : entry;
  });
}

export function renderSiteOrigin(source: string, origin: string): string {
  return source.split(SITE_ORIGIN_PLACEHOLDER).join(origin);
}
