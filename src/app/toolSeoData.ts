// Pure data and helpers shared by the browser app and the Node server. Keep this
// module free of React/DOM imports so the server bundle can use it.

export interface ToolSeoEntry {
  title: string;
  description: string;
  structuredData: {
    name: string;
    description: string;
    applicationCategory: string;
  };
}

export const toolSeoData = {
  totp: {
    title: "TOTP Generator - Free 2FA Codes | Web Tools",
    description:
      "Generate TOTP two-factor authentication codes in your browser. Compatible with Google Authenticator and Microsoft Authenticator, with no secret storage or server calls.",
    structuredData: {
      name: "TOTP Generator",
      description: "Browser-based TOTP two-factor authentication code generator",
      applicationCategory: "SecurityApplication",
    },
  },
  "url-shortener": {
    title: "URL Shortener | Web Tools",
    description:
      "Create generated or custom short links that expire automatically, with public click statistics.",
    structuredData: {
      name: "URL Shortener",
      description:
        "Create short links that expire automatically, with public click statistics",
      applicationCategory: "UtilitiesApplication",
    },
  },
} satisfies Record<string, ToolSeoEntry>;

export type SeoToolId = keyof typeof toolSeoData;

export const DEFAULT_SEO_TOOL_ID: SeoToolId = "totp";

const TOOL_PATH = /^\/([^/]+)\/?$/;

/** Resolves a request pathname to the tool whose metadata it should carry. */
export function seoToolIdFromPathname(pathname: string): SeoToolId {
  const id = TOOL_PATH.exec(pathname)?.[1];
  return id !== undefined &&
    Object.prototype.hasOwnProperty.call(toolSeoData, id)
    ? (id as SeoToolId)
    : DEFAULT_SEO_TOOL_ID;
}
