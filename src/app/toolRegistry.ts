import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import { ShieldCheck } from "lucide-react";
import { TotpPage } from "../features/totp";

export type ToolId = "totp";

export interface ToolDefinition {
  id: ToolId;
  label: string;
  description: string;
  Icon: LucideIcon;
  Page: ComponentType;
}

// Register new feature modules here, for example a future url-shortener tool.
export const tools: ToolDefinition[] = [
  {
    id: "totp",
    label: "TOTP Generator",
    description: "RFC 6238 · HMAC-SHA1",
    Icon: ShieldCheck,
    Page: TotpPage,
  },
];
