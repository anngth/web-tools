import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import type { GetConnInfo } from "hono/conninfo";
import { pathToFileURL } from "node:url";
import {
  createShortLinkBackend,
  type BackendEnvironment,
  type BackendSelection,
} from "./backend-factory";
import {
  createCleanupController,
  type CleanupController,
} from "./cleanup-scheduler";
import { createJsonLogger, type AppLogger } from "./logger";
import { createPublicApp } from "./public-app";
import {
  createFixedWindowLimiter,
  resolveClientKey,
} from "./rate-limiter";

export const CLEANUP_INTERVAL_MS = 300_000 as const;
export const SHUTDOWN_TIMEOUT_MS = 10_000 as const;
const PORT = 8080 as const;
const HOSTNAME = "0.0.0.0";

interface DockerServerEnvironment extends BackendEnvironment {
  NODE_ENV?: string;
  PUBLIC_BASE_URL?: string;
  TRUST_PROXY?: string;
}

export interface RuntimeListener {
  close(callback: (error?: Error) => void): unknown;
  closeAllConnections?(): void;
  once(event: "error", handler: (error: Error) => void): unknown;
  off(event: "error", handler: (error: Error) => void): unknown;
}

export interface DockerServerDependencies {
  createBackend(env: BackendEnvironment): BackendSelection;
  createCleanup(options: {
    backend: BackendSelection["backend"];
    logger: AppLogger;
  }): CleanupController;
  createApp: typeof createPublicApp;
  createLimiter: typeof createFixedWindowLimiter;
  listen(
    options: {
      fetch: ReturnType<typeof createPublicApp>["fetch"];
      port: number;
      hostname: string;
    },
    onListening: () => void,
  ): RuntimeListener;
  getConnectionInfo: GetConnInfo;
  logger: AppLogger;
  registerSignal(signal: NodeJS.Signals, handler: () => void): void;
  exit(code: number): void;
  setTimeoutFn: typeof setTimeout;
  clearTimeoutFn: typeof clearTimeout;
}

export interface DockerServerRuntime {
  shutdown(): Promise<void>;
}

const defaultDependencies: DockerServerDependencies = {
  createBackend: createShortLinkBackend,
  createCleanup: createCleanupController,
  createApp: createPublicApp,
  createLimiter: createFixedWindowLimiter,
  listen(options, onListening) {
    return serve(options, onListening) as RuntimeListener;
  },
  getConnectionInfo: getConnInfo,
  logger: createJsonLogger(),
  registerSignal(signal, handler) {
    process.once(signal, handler);
  },
  exit(code) {
    process.exit(code);
  },
  setTimeoutFn: setTimeout,
  clearTimeoutFn: clearTimeout,
};

export function createNodeClientKeyResolver(
  trustProxy: boolean,
  getConnectionInformation: GetConnInfo = getConnInfo,
): (context: Context) => string {
  return (context) => {
    const peerAddress = getConnectionInformation(context).remote.address;
    if (peerAddress === undefined) {
      throw new Error("Direct peer address is unavailable");
    }
    return resolveClientKey({
      peerAddress,
      xForwardedFor: context.req.header("x-forwarded-for"),
      trustProxy,
    });
  };
}

export async function startDockerServer(options: {
  env?: DockerServerEnvironment;
  dependencies?: DockerServerDependencies;
} = {}): Promise<DockerServerRuntime> {
  const env = options.env ?? process.env;
  const dependencies = options.dependencies ?? defaultDependencies;
  const publicBaseUrl = validatePublicBaseUrl(env.PUBLIC_BASE_URL, env.NODE_ENV);
  const trustProxy = parseTrustProxy(env.TRUST_PROXY);
  const selection = dependencies.createBackend(env);
  const cleanup = dependencies.createCleanup({
    backend: selection.backend,
    logger: dependencies.logger,
  });
  const limiter = dependencies.createLimiter({
    limit: 10,
    windowMs: 60_000,
    maxKeys: 10_000,
  });
  const app = dependencies.createApp({
    backend: selection.backend,
    publicBaseUrl,
    getClientKey: createNodeClientKeyResolver(
      trustProxy,
      dependencies.getConnectionInfo,
    ),
    limiter,
    logger: dependencies.logger,
    staticRoot: "./dist",
  });

  dependencies.logger.info("server_start", {
    backendType: selection.backendType,
    port: PORT,
    intervalMs: CLEANUP_INTERVAL_MS,
  });
  await cleanup.run("startup");
  cleanup.start();

  let listener!: RuntimeListener;
  let shutdownPromise: Promise<void> | undefined;
  let backendClosePromise: Promise<void> | undefined;
  let shutdownStarted = false;

  const closeBackendOnce = (): Promise<void> => {
    backendClosePromise ??= Promise.resolve().then(() => selection.backend.close?.());
    return backendClosePromise;
  };
  const shutdown = (): Promise<void> => {
    if (shutdownPromise !== undefined) return shutdownPromise;
    shutdownStarted = true;

    shutdownPromise = (async () => {
      dependencies.logger.info("shutdown_started");
      const listenerDrained = new Promise<void>((resolve) => {
        listener.close(() => resolve());
      });
      cleanup.stop();

      let timeout: ReturnType<typeof setTimeout> | undefined;
      const timedOut = await Promise.race([
        Promise.all([listenerDrained, cleanup.waitForIdle()]).then(() => false),
        new Promise<true>((resolve) => {
          timeout = dependencies.setTimeoutFn(() => resolve(true), SHUTDOWN_TIMEOUT_MS);
        }),
      ]);

      if (timedOut) {
        listener.closeAllConnections?.();
      } else if (timeout !== undefined) {
        dependencies.clearTimeoutFn(timeout);
      }

      try {
        await closeBackendOnce();
        dependencies.logger.info("shutdown_completed");
        dependencies.exit(0);
      } catch {
        dependencies.logger.error("request_failed", {
          reason: "backend_close_failed",
        });
        dependencies.exit(1);
      }
    })();
    return shutdownPromise;
  };
  const handleSignal = (): void => {
    void shutdown();
  };

  let resolveListening!: () => void;
  let rejectListening!: (error: Error) => void;
  const listening = new Promise<void>((resolve, reject) => {
    resolveListening = resolve;
    rejectListening = reject;
  });
  listener = dependencies.listen(
    { fetch: app.fetch, port: PORT, hostname: HOSTNAME },
    resolveListening,
  );
  const handleListenerError = (_error: Error): void => {
    rejectListening(new Error("Server failed to listen"));
  };
  listener.once("error", handleListenerError);
  dependencies.registerSignal("SIGTERM", handleSignal);
  dependencies.registerSignal("SIGINT", handleSignal);

  try {
    await listening;
  } catch (error) {
    cleanup.stop();
    await closeBackendOnce();
    throw error;
  } finally {
    listener.off("error", handleListenerError);
  }

  if (!shutdownStarted) {
    dependencies.logger.info("server_ready", {
      backendType: selection.backendType,
      port: PORT,
    });
  }

  return { shutdown };
}

function parseTrustProxy(value: string | undefined): boolean {
  if (value === undefined || value === "false") return false;
  if (value === "true") return true;
  throw new TypeError("TRUST_PROXY configuration is invalid");
}

function validatePublicBaseUrl(
  value: string | undefined,
  nodeEnvironment: string | undefined,
): string | undefined {
  if (value === undefined) {
    if (nodeEnvironment === "production") {
      throw new TypeError("PUBLIC_BASE_URL is required in production");
    }
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("PUBLIC_BASE_URL configuration is invalid");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new TypeError("PUBLIC_BASE_URL configuration is invalid");
  }
  return url.origin;
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  void startDockerServer().catch(() => {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      event: "server_start_failed",
      reason: "invalid_configuration_or_startup_failure",
    }));
    process.exit(1);
  });
}
