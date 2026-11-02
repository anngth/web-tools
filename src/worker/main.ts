import type { Hono } from "hono";
import { createJsonLogger } from "../server/http/logger";
import type { AppBindings } from "../server/http/public-routes";
import { LocalShortLinkBackend } from "../shared/short-links/local-backend.ts";
import { deleteExpiredRateLimitWindows } from "./http/d1-rate-limiter";
import { createWorkerPublicApp, type PublicWorkerEnv } from "./http/public-app";
import { D1ShortLinkStore } from "./short-links/d1-store";
import gateway from "./short-links/worker";

export interface WorkerEnv extends PublicWorkerEnv {
  /** Token for the `/internal/*` gateway the Docker server used. */
  GATEWAY_TOKEN?: string;
}

const logger = createJsonLogger();

// Bindings and vars are fixed for the life of an isolate, so the app is built
// once per env object instead of once per request.
const publicApps = new WeakMap<WorkerEnv, Hono<AppBindings>>();

function publicAppFor(env: WorkerEnv): Hono<AppBindings> {
  let app = publicApps.get(env);
  if (app === undefined) {
    app = createWorkerPublicApp(env, { logger });
    publicApps.set(env, app);
  }
  return app;
}

function isGatewayPath(pathname: string): boolean {
  return pathname === "/internal" || pathname.startsWith("/internal/");
}

export async function runScheduledCleanup(env: WorkerEnv, now: Date): Promise<void> {
  const startedAt = performance.now();
  try {
    const deletedCount = await new LocalShortLinkBackend(
      new D1ShortLinkStore(env.DB),
      1,
    ).deleteExpired(now);
    await deleteExpiredRateLimitWindows(env.DB, now);
    logger.info("cleanup_completed", {
      trigger: "scheduled",
      deletedCount,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    });
  } catch {
    logger.error("cleanup_failed", {
      trigger: "scheduled",
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    });
  }
}

export default {
  fetch(request, env, ctx) {
    return isGatewayPath(new URL(request.url).pathname)
      ? gateway.fetch(request, env, ctx)
      : publicAppFor(env).fetch(request, env, ctx);
  },
  scheduled(controller, env, ctx) {
    ctx.waitUntil(runScheduledCleanup(env, new Date(controller.scheduledTime)));
  },
} satisfies ExportedHandler<WorkerEnv>;
