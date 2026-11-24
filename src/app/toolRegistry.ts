import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import { Link2, ShieldCheck } from "lucide-react";
import { TotpPage } from "../features/totp";
import { parseDisabledTools } from "./disabledTools";
import { UrlShortenerPage } from "../features/url-shortener";

export type ToolId = "totp" | "url-shortener";

export interface ToolDefinition {
  id: ToolId;
  label: string;
  description: string;
  Icon: LucideIcon;
  Page: ComponentType;
}

const allTools: ToolDefinition[] = [
  {
    id: "totp",
    label: "TOTP Generator",
    description: "RFC 6238 · Time-based one-time passwords",
    Icon: ShieldCheck,
    Page: TotpPage,
  },
  {
    id: "url-shortener",
    label: "URL Shortener",
    description: "Short links · Automatic expiry · Click stats",
    Icon: Link2,
    Page: UrlShortenerPage,
  },
];

/**
 * The server lists tools switched off at runtime (the `DISABLED_TOOLS` variable)
 * in a meta tag of index.html. Without the tag, such as under Vite, all show.
 */
function disabledToolIds(): ReadonlySet<string> {
  const content = document
    .querySelector('meta[name="disabled-tools"]')
    ?.getAttribute("content");
  return parseDisabledTools(content).ids;
}

export function enabledTools(
  candidates: ToolDefinition[],
  disabled: ReadonlySet<string>,
): ToolDefinition[] {
  return candidates.filter((tool) => !disabled.has(tool.id));
}

export const tools: ToolDefinition[] = enabledTools(allTools, disabledToolIds());
