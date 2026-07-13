import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import { Link2, ShieldCheck } from "lucide-react";
import { TotpPage } from "../features/totp";
import { UrlShortenerPage } from "../features/url-shortener";

export type ToolId = "totp" | "url-shortener";

export interface ToolDefinition {
  id: ToolId;
  label: string;
  description: string;
  Icon: LucideIcon;
  Page: ComponentType;
}

export const tools: ToolDefinition[] = [
  {
    id: "totp",
    label: "TOTP Generator",
    description: "RFC 6238 · HMAC-SHA1",
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
