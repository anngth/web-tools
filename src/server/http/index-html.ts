import {
  DEFAULT_SEO_TOOL_ID,
  seoToolIdFromPathname,
  toolSeoData,
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
 * data of the tool the path belongs to.
 */
export function renderIndexHtml(
  source: string,
  origin: string,
  pathname: string,
): string {
  const toolId = seoToolIdFromPathname(pathname);
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

  return renderSiteOrigin(html, origin);
}

export function renderSiteOrigin(source: string, origin: string): string {
  return source.split(SITE_ORIGIN_PLACEHOLDER).join(origin);
}
