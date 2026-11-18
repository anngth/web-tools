// Pure helpers shared by the browser app and the servers. Keep this module free
// of React/DOM imports so the server bundle can use it.
import {
  DEFAULT_SEO_TOOL_ID,
  toolSeoData,
  type SeoToolId,
} from "./toolSeoData";

export const TOOL_IDS = Object.keys(toolSeoData) as SeoToolId[];

export interface DisabledTools {
  ids: ReadonlySet<SeoToolId>;
  /** Entries that are not tool ids; they are ignored. */
  unknown: string[];
  /** Every tool was listed. The list is then dropped so the site stays usable. */
  allDisabled: boolean;
}

function isToolId(value: string): value is SeoToolId {
  return Object.prototype.hasOwnProperty.call(toolSeoData, value);
}

/** Parses the comma-separated `DISABLED_TOOLS` runtime variable. */
export function parseDisabledTools(raw: string | null | undefined): DisabledTools {
  const ids = new Set<SeoToolId>();
  const unknown: string[] = [];
  for (const entry of (raw ?? "").split(",")) {
    const value = entry.trim();
    if (value === "") continue;
    if (isToolId(value)) ids.add(value);
    else unknown.push(value);
  }
  if (ids.size >= TOOL_IDS.length) {
    return { ids: new Set(), unknown, allDisabled: true };
  }
  return { ids, unknown, allDisabled: false };
}

/** The tool unknown or disabled paths resolve to. */
export function fallbackToolId(disabled: ReadonlySet<SeoToolId>): SeoToolId {
  if (!disabled.has(DEFAULT_SEO_TOOL_ID)) return DEFAULT_SEO_TOOL_ID;
  return TOOL_IDS.find((id) => !disabled.has(id)) ?? DEFAULT_SEO_TOOL_ID;
}
