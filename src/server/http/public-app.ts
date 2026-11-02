import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Context, Hono } from "hono";
import type { AppLogger } from "./logger";
import type { RateLimiter } from "./rate-limiter";
import { renderIndexHtml, renderSiteOrigin } from "./index-html";
import {
  createPublicRoutes,
  publicError,
  validatePublicOrigin,
  type AppBindings,
} from "./public-routes";
import type { ShortLinkBackend } from "../../shared/short-links/short-link-backend.ts";

export function createPublicApp(options: {
  backend: ShortLinkBackend;
  publicBaseUrl?: string;
  getClientKey: (context: Context) => string;
  limiter: RateLimiter;
  logger: AppLogger;
  now?: () => Date;
  staticRoot?: string;
}): Hono<AppBindings> {
  const configuredOrigin = validatePublicOrigin(options.publicBaseUrl);
  if (configuredOrigin === undefined && process.env.NODE_ENV === "production") {
    throw new TypeError("PUBLIC_BASE_URL is required in production");
  }

  const app = createPublicRoutes(options);

  if (options.staticRoot !== undefined) {
    const setStaticCacheHeader = (path: string, context: Context): void => {
      if (
        path === "/" ||
        path.endsWith("/") ||
        path.endsWith("/index.html") ||
        path.endsWith("\\index.html")
      ) {
        context.header("Cache-Control", "no-store");
      } else if (/-[a-zA-Z0-9_-]{8}\.[^/\\]+$/.test(path)) {
        context.header("Cache-Control", "public, max-age=31536000, immutable");
      } else {
        context.header("Cache-Control", "no-cache");
      }
    };
    const staticFiles = serveStatic({ root: options.staticRoot });
    // Files that carry absolute URLs use a placeholder so the deployed domain
    // comes from PUBLIC_BASE_URL (or the request origin in local development).
    const templateRoot = resolve(options.staticRoot);
    const templateSources = new Map<string, Promise<string | undefined>>();
    const loadTemplate = (file: string): Promise<string | undefined> => {
      let source = templateSources.get(file);
      if (source === undefined) {
        const pending = readFile(join(templateRoot, file), "utf8").catch(
          () => undefined,
        );
        // Only successful reads stay cached, so a late-arriving file is picked up.
        void pending.then((value) => {
          if (value === undefined) templateSources.delete(file);
        });
        templateSources.set(file, pending);
        source = pending;
      }
      return source;
    };
    const serveTemplate =
      (
        file: string,
        contentType: string,
        cacheControl: string,
        config: {
          render?: (source: string, origin: string, path: string) => string;
          onMissing: "next" | "not_found";
        },
      ) =>
      async (context: Context, next: () => Promise<void>) => {
        const source = await loadTemplate(file);
        if (source === undefined) {
          return config.onMissing === "next"
            ? next()
            : publicError(context, 404, "not_found");
        }
        const origin = configuredOrigin ?? new URL(context.req.url).origin;
        const render = config.render ?? renderSiteOrigin;
        return context.body(render(source, origin, context.req.path), 200, {
          "Content-Type": contentType,
          "Cache-Control": cacheControl,
        });
      };
    const serveIndex = serveTemplate(
      "index.html",
      "text/html; charset=utf-8",
      "no-store",
      {
        render: (source, origin, path) =>
          renderIndexHtml(source, origin, path),
        onMissing: "next",
      },
    );

    app.get(
      "/robots.txt",
      serveTemplate("robots.txt", "text/plain; charset=utf-8", "no-cache", {
        onMissing: "not_found",
      }),
    );
    app.get(
      "/sitemap.xml",
      serveTemplate("sitemap.xml", "application/xml; charset=utf-8", "no-cache", {
        onMissing: "not_found",
      }),
    );
    app.get("/", serveIndex);
    app.get("/index.html", serveIndex);

    app.get("*", async (context, next) => {
      setStaticCacheHeader(context.req.path, context);
      return staticFiles(context, next);
    });
    app.get("*", serveIndex);
  }

  app.notFound((context) => publicError(context, 404, "not_found"));
  return app;
}
