import { type ToolId, tools } from "./toolRegistry";

// First path segments owned by the server. A tool id must never match one of
// these, otherwise its page would be shadowed by (or shadow) a backend route.
export const RESERVED_PATH_SEGMENTS = [
  "api",
  "s",
  "healthz",
  "assets",
  "index.html",
  "robots.txt",
  "sitemap.xml",
  "favicon.svg",
] as const;

const TOOL_PATH = /^\/([^/]+)\/?$/;

export function toolIdFromPathname(pathname: string): ToolId {
  const id = TOOL_PATH.exec(pathname)?.[1];
  return tools.find((tool) => tool.id === id)?.id ?? tools[0].id;
}

export function pathnameForTool(toolId: ToolId): string {
  return `/${toolId}`;
}

export function canonicalPathname(pathname: string): string {
  return pathnameForTool(toolIdFromPathname(pathname));
}
