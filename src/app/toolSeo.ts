import { pathnameForTool } from "./toolRoute";
import type { ToolId } from "./toolRegistry";
import { type ToolSeoEntry, toolSeoData } from "./toolSeoData";

// Typed against ToolId so a new tool cannot be added without SEO metadata.
export const toolSeo: Record<ToolId, ToolSeoEntry> = toolSeoData;

function headElement<K extends "meta" | "link">(
  tag: K,
  selector: string,
  attrs: Record<string, string>,
): HTMLElementTagNameMap[K] {
  let element = document.head.querySelector<HTMLElementTagNameMap[K]>(selector);
  if (!element) {
    element = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) {
      element.setAttribute(name, value);
    }
    document.head.appendChild(element);
  }
  return element;
}

export function applyToolSeo(toolId: ToolId): void {
  const seo = toolSeo[toolId];
  document.title = seo.title;
  headElement("meta", 'meta[name="description"]', {
    name: "description",
  }).setAttribute("content", seo.description);
  headElement("link", 'link[rel="canonical"]', { rel: "canonical" }).setAttribute(
    "href",
    `${window.location.origin}${pathnameForTool(toolId)}`,
  );
}
