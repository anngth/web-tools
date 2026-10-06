import { describe, expect, it } from "vitest";
import { renderIndexHtml } from "./index-html";

const source = `<html><head>
    <title>TOTP Generator | Web Tools</title>
    <meta
      name="description"
      content="TOTP description"
    />
    <link rel="canonical" href="__SITE_ORIGIN__/totp" />
    <script type="application/ld+json">
      { "name": "TOTP Generator", "url": "__SITE_ORIGIN__/totp" }
    </script>
  </head></html>`;
const origin = "https://example.org";

describe("renderIndexHtml", () => {
  it("keeps TOTP metadata for the home and TOTP paths", () => {
    for (const path of ["/", "/totp", "/totp/", "/bogus"]) {
      const html = renderIndexHtml(source, origin, path);
      expect(html).toContain("<title>TOTP Generator - Free 2FA Codes | Web Tools</title>");
      expect(html).toContain(
        '<link rel="canonical" href="https://example.org/totp" />',
      );
      expect(html).toContain('"name": "TOTP Generator"');
      expect(html).not.toContain("__SITE_ORIGIN__");
    }
  });

  it("serves URL Shortener metadata without running JavaScript", () => {
    const html = renderIndexHtml(source, origin, "/url-shortener");

    expect(html).toContain("<title>URL Shortener | Web Tools</title>");
    expect(html).toContain(
      '<link rel="canonical" href="https://example.org/url-shortener" />',
    );
    expect(html).toContain('content="Create generated or custom short links');
    expect(html).not.toContain("TOTP description");
    expect(html).not.toContain("TOTP Generator");
    const jsonLd = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(
      html,
    )?.[1];
    expect(JSON.parse(jsonLd ?? "")).toMatchObject({
      "@type": "SoftwareApplication",
      name: "URL Shortener",
      url: "https://example.org/url-shortener",
    });
  });

  it("leaves a shell without the SEO tags untouched apart from the origin", () => {
    expect(renderIndexHtml("<p>__SITE_ORIGIN__</p>", origin, "/url-shortener")).toBe(
      "<p>https://example.org</p>",
    );
  });
});
