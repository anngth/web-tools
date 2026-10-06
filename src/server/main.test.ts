import type { Context } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CleanupController } from "./http/cleanup-scheduler";
import type { AppLogger } from "./http/logger";
import type { ShortLinkBackend } from "../shared/short-links/short-link-backend.ts";
import {
  CLEANUP_INTERVAL_MS,
  SHUTDOWN_TIMEOUT_MS,
  createNodeClientKeyResolver,
  startDockerServer,
  type DockerServerDependencies,
  type RuntimeListener,
} from "./main";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createHarness(overrides: Partial<DockerServerDependencies> = {}) {
  const events: string[] = [];
  const backend: ShortLinkBackend = {
    create: vi.fn(),
    resolve: vi.fn(),
    stats: vi.fn(),
    deleteExpired: vi.fn().mockResolvedValue(0),
    close: vi.fn(async () => {
      events.push("backend_closed");
    }),
  };
  const cleanup: CleanupController = {
    run: vi.fn().mockResolvedValue(undefined),
    start: vi.fn(),
    stop: vi.fn(() => {
      events.push("scheduler_stopped");
    }),
    waitForIdle: vi.fn().mockResolvedValue(undefined),
  };
  const listener: RuntimeListener = {
    close: vi.fn((callback) => callback()),
    closeAllConnections: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
  };
  const logger: AppLogger = {
    info: vi.fn((event) => events.push(event)),
    error: vi.fn(),
  };
  const signalHandlers = new Map<NodeJS.Signals, () => void>();

  const dependencies: DockerServerDependencies = {
    createBackend: vi.fn(async () => ({
      backend,
      backendType: "d1" as const,
      ttlSeconds: 60,
      maxActiveLinks: undefined,
    })),
    createCleanup: vi.fn(() => cleanup),
    createApp: vi.fn(() => ({ fetch: vi.fn() }) as never),
    createLimiter: vi.fn(() => ({
      consume: vi.fn(() => ({ allowed: true, retryAfterSeconds: 0 })),
    })),
    listen: vi.fn((_options, onListening) => {
      onListening();
      return listener;
    }),
    getConnectionInfo: vi.fn(() => ({
      remote: { address: "127.0.0.1", addressType: "IPv4" },
    })),
    logger,
    registerSignal: vi.fn((signal, handler) => {
      signalHandlers.set(signal, handler);
    }),
    exit: vi.fn(),
    setTimeoutFn: setTimeout,
    clearTimeoutFn: clearTimeout,
    ...overrides,
  };

  return {
    backend,
    cleanup,
    dependencies,
    events,
    listener,
    logger,
    signalHandlers,
  };
}

const VALID_ENV = {
  NODE_ENV: "production",
  DATABASE_BACKEND: "sqlite",
  SQLITE_PATH: ":memory:",
  URL_SHORTENER_TTL_SECONDS: "60",
  PUBLIC_BASE_URL: "https://sho.rt",
  TRUST_PROXY: "false",
};

describe("startDockerServer configuration and startup", () => {
  it.each([
    ["backend", { ...VALID_ENV, DATABASE_BACKEND: "invalid" }],
    ["TTL", { ...VALID_ENV, URL_SHORTENER_TTL_SECONDS: "0" }],
  ])("rejects invalid %s configuration before listening", async (_name, env) => {
    const harness = createHarness();
    harness.dependencies.createBackend = vi.fn(() => {
      throw new Error("Invalid short link backend configuration");
    });

    await expect(startDockerServer({ env, dependencies: harness.dependencies })).rejects.toThrow(
      "Invalid short link backend configuration",
    );

    expect(harness.dependencies.listen).not.toHaveBeenCalled();
  });

  it.each([
    ["missing PUBLIC_BASE_URL", { ...VALID_ENV, PUBLIC_BASE_URL: undefined }],
    ["invalid PUBLIC_BASE_URL", { ...VALID_ENV, PUBLIC_BASE_URL: "https://sho.rt/path" }],
    ["invalid TRUST_PROXY", { ...VALID_ENV, TRUST_PROXY: "yes" }],
    ["invalid RATE_LIMIT_PER_HOUR", { ...VALID_ENV, RATE_LIMIT_PER_HOUR: "lots" }],
    ["all rate limit windows disabled", {
      ...VALID_ENV,
      RATE_LIMIT_PER_MINUTE: "0",
      RATE_LIMIT_PER_HOUR: "0",
      RATE_LIMIT_PER_DAY: "0",
    }],
  ])("rejects %s before constructing a backend or listening", async (_name, env) => {
    const harness = createHarness();

    await expect(startDockerServer({ env, dependencies: harness.dependencies })).rejects.toThrow(
      /configuration|PUBLIC_BASE_URL|TRUST_PROXY|RATE_LIMIT/,
    );

    expect(harness.dependencies.createBackend).not.toHaveBeenCalled();
    expect(harness.dependencies.listen).not.toHaveBeenCalled();
  });

  it("creates the limiter with default per-minute, per-hour, and per-day quotas", async () => {
    const harness = createHarness();

    await startDockerServer({ env: VALID_ENV, dependencies: harness.dependencies });

    expect(harness.dependencies.createLimiter).toHaveBeenCalledWith({
      rules: [
        { limit: 10, windowMs: 60_000 },
        { limit: 60, windowMs: 3_600_000 },
        { limit: 200, windowMs: 86_400_000 },
      ],
      maxKeys: 10_000,
    });
  });

  it("configures limiter quotas from the environment", async () => {
    const harness = createHarness();

    await startDockerServer({
      env: {
        ...VALID_ENV,
        RATE_LIMIT_PER_MINUTE: "2",
        RATE_LIMIT_PER_HOUR: "0",
        RATE_LIMIT_PER_DAY: "25",
      },
      dependencies: harness.dependencies,
    });

    expect(harness.dependencies.createLimiter).toHaveBeenCalledWith({
      rules: [
        { limit: 2, windowMs: 60_000 },
        { limit: 25, windowMs: 86_400_000 },
      ],
      maxKeys: 10_000,
    });
  });

  it("awaits startup cleanup before scheduling, listening, or logging readiness", async () => {
    const startupCleanup = deferred<void>();
    const harness = createHarness();
    vi.mocked(harness.cleanup.run).mockReturnValue(startupCleanup.promise);

    const starting = startDockerServer({ env: VALID_ENV, dependencies: harness.dependencies });
    await Promise.resolve();

    expect(harness.cleanup.run).toHaveBeenCalledWith("startup");
    expect(harness.cleanup.start).not.toHaveBeenCalled();
    expect(harness.dependencies.listen).not.toHaveBeenCalled();
    expect(harness.logger.info).toHaveBeenCalledWith("server_start", {
      backendType: "d1",
      port: 8080,
      intervalMs: CLEANUP_INTERVAL_MS,
    });
    expect(harness.logger.info).not.toHaveBeenCalledWith("server_ready", expect.anything());

    startupCleanup.resolve();
    await starting;

    expect(harness.cleanup.start).toHaveBeenCalledTimes(1);
    expect(harness.dependencies.listen).toHaveBeenCalledTimes(1);
    expect(harness.logger.info).toHaveBeenCalledWith("server_ready", {
      backendType: "d1",
      port: 8080,
    });
    expect(harness.signalHandlers.has("SIGTERM")).toBe(true);
    expect(harness.signalHandlers.has("SIGINT")).toBe(true);
    expect(vi.mocked(harness.logger.info).mock.calls.filter(([event]) => (
      event === "server_start" || event === "server_ready"
    ))).toEqual([
      ["server_start", { backendType: "d1", port: 8080, intervalMs: CLEANUP_INTERVAL_MS }],
      ["server_ready", { backendType: "d1", port: 8080 }],
    ]);
  });

  it("records d1_unavailable when the selected backend is Postgres", async () => {
    const harness = createHarness();
    harness.dependencies.createBackend = vi.fn(async () => ({
      backend: harness.backend,
      backendType: "postgres" as const,
      ttlSeconds: 60,
      maxActiveLinks: undefined,
    }));

    await startDockerServer({ env: VALID_ENV, dependencies: harness.dependencies });

    expect(harness.logger.info).toHaveBeenCalledWith("server_start", {
      backendType: "postgres",
      port: 8080,
      intervalMs: CLEANUP_INTERVAL_MS,
      reason: "d1_unavailable",
    });
    expect(harness.logger.info).toHaveBeenCalledWith("server_ready", {
      backendType: "postgres",
      port: 8080,
      reason: "d1_unavailable",
    });
  });

  it("registers graceful signal handling as soon as the listener is created", async () => {
    const harness = createHarness();
    let listening!: () => void;
    vi.mocked(harness.dependencies.listen).mockImplementation((_options, onListening) => {
      listening = onListening;
      return harness.listener;
    });

    const starting = startDockerServer({ env: VALID_ENV, dependencies: harness.dependencies });
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.signalHandlers.has("SIGTERM")).toBe(true);
    harness.signalHandlers.get("SIGTERM")?.();
    await vi.waitFor(() => {
      expect(harness.backend.close).toHaveBeenCalledTimes(1);
    });
    expect(harness.dependencies.exit).toHaveBeenCalledWith(0);

    listening();
    await starting;
  });

  it("rejects listener startup errors and finalizes startup resources once", async () => {
    const harness = createHarness();
    let listenerError: ((error: Error) => void) | undefined;
    vi.mocked(harness.listener.once).mockImplementation((event, handler) => {
      if (event === "error") listenerError = handler;
      return harness.listener;
    });
    vi.mocked(harness.dependencies.listen).mockImplementation(() => harness.listener);

    const starting = startDockerServer({ env: VALID_ENV, dependencies: harness.dependencies });
    await Promise.resolve();
    await Promise.resolve();

    expect(listenerError).toBeTypeOf("function");
    listenerError?.(new Error("EADDRINUSE"));

    await expect(starting).rejects.toThrow("Server failed to listen");
    expect(harness.cleanup.stop).toHaveBeenCalledTimes(1);
    expect(harness.backend.close).toHaveBeenCalledTimes(1);
    expect(harness.logger.info).not.toHaveBeenCalledWith("server_ready", expect.anything());
    expect(harness.dependencies.exit).not.toHaveBeenCalled();
  });

  it("caches a synchronously throwing backend finalizer across startup failure and signal", async () => {
    const harness = createHarness();
    let listenerError!: (error: Error) => void;
    vi.mocked(harness.listener.once).mockImplementation((_event, handler) => {
      listenerError = handler;
      return harness.listener;
    });
    vi.mocked(harness.dependencies.listen).mockImplementation(() => harness.listener);
    vi.mocked(harness.backend.close).mockImplementation(() => {
      throw new Error("synchronous close failure");
    });

    const starting = startDockerServer({ env: VALID_ENV, dependencies: harness.dependencies });
    await Promise.resolve();
    await Promise.resolve();
    listenerError(new Error("EADDRINUSE"));
    await expect(starting).rejects.toThrow();

    harness.signalHandlers.get("SIGTERM")?.();
    await vi.waitFor(() => {
      expect(harness.dependencies.exit).toHaveBeenCalledWith(1);
    });
    expect(harness.backend.close).toHaveBeenCalledTimes(1);
  });
});

describe("createNodeClientKeyResolver", () => {
  function contextWithForwardedFor(value: string): Context {
    return {
      req: { header: vi.fn(() => value) },
    } as unknown as Context;
  }

  it("uses only the direct Node connection peer when proxy trust is disabled", () => {
    const getConnectionInfo = vi.fn(() => ({
      remote: { address: "192.0.2.10", addressType: "IPv4" as const },
    }));
    const resolve = createNodeClientKeyResolver(false, getConnectionInfo);

    expect(resolve(contextWithForwardedFor("203.0.113.9"))).toBe("192.0.2.10");
    expect(getConnectionInfo).toHaveBeenCalledTimes(1);
  });

  it("uses the first valid forwarded address in trusted-proxy mode", () => {
    const resolve = createNodeClientKeyResolver(
      true,
      vi.fn(() => ({
        remote: { address: "192.0.2.10", addressType: "IPv4" as const },
      })),
    );

    expect(resolve(contextWithForwardedFor("unknown, , 2001:db8::1, 203.0.113.9"))).toBe(
      "2001:db8::1",
    );
  });
});

describe("startDockerServer shutdown", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops acceptance and scheduling, drains requests and cleanup, then closes once", async () => {
    const request = deferred<void>();
    const cleanup = deferred<void>();
    const harness = createHarness();
    vi.mocked(harness.listener.close).mockImplementation((callback) => {
      harness.events.push("listener_close_started");
      void request.promise.then(callback);
    });
    vi.mocked(harness.cleanup.waitForIdle).mockReturnValue(cleanup.promise);
    const runtime = await startDockerServer({ env: VALID_ENV, dependencies: harness.dependencies });
    harness.events.length = 0;

    harness.signalHandlers.get("SIGTERM")?.();
    const shutdown = runtime.shutdown();

    expect(harness.events).toEqual([
      "shutdown_started",
      "listener_close_started",
      "scheduler_stopped",
    ]);
    request.resolve();
    cleanup.resolve();
    await shutdown;

    expect(harness.events.at(-2)).toBe("backend_closed");
    expect(harness.events.at(-1)).toBe("shutdown_completed");
    expect(harness.listener.closeAllConnections).not.toHaveBeenCalled();
    expect(harness.backend.close).toHaveBeenCalledTimes(1);
    expect(harness.dependencies.exit).toHaveBeenCalledTimes(1);

    await runtime.shutdown();
    harness.signalHandlers.get("SIGINT")?.();
    await Promise.resolve();
    expect(harness.backend.close).toHaveBeenCalledTimes(1);
    expect(harness.logger.info).toHaveBeenCalledWith("shutdown_completed");
    expect(vi.mocked(harness.logger.info).mock.calls.filter(([event]) => event === "shutdown_completed"))
      .toHaveLength(1);
  });

  it("forces connections closed at ten seconds before one backend close", async () => {
    vi.useFakeTimers();
    const harness = createHarness({ setTimeoutFn: setTimeout, clearTimeoutFn: clearTimeout });
    vi.mocked(harness.listener.close).mockImplementation(() => {
      harness.events.push("listener_close_started");
    });
    vi.mocked(harness.listener.closeAllConnections).mockImplementation(() => {
      harness.events.push("connections_forced_closed");
    });
    vi.mocked(harness.cleanup.waitForIdle).mockReturnValue(new Promise(() => undefined));
    const runtime = await startDockerServer({ env: VALID_ENV, dependencies: harness.dependencies });
    harness.events.length = 0;

    const shutdown = runtime.shutdown();
    await vi.advanceTimersByTimeAsync(SHUTDOWN_TIMEOUT_MS - 1);
    expect(harness.backend.close).not.toHaveBeenCalled();
    expect(harness.listener.closeAllConnections).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await shutdown;

    expect(harness.events.indexOf("connections_forced_closed")).toBeLessThan(
      harness.events.indexOf("backend_closed"),
    );
    expect(harness.listener.closeAllConnections).toHaveBeenCalledTimes(1);
    expect(harness.backend.close).toHaveBeenCalledTimes(1);
    expect(harness.dependencies.exit).toHaveBeenCalledTimes(1);
  });

  it("logs a generic failure and exits nonzero when the backend cannot close", async () => {
    const harness = createHarness();
    vi.mocked(harness.backend.close).mockRejectedValue(
      new Error("sensitive sqlite path and raw failure"),
    );
    const runtime = await startDockerServer({ env: VALID_ENV, dependencies: harness.dependencies });

    await expect(runtime.shutdown()).resolves.toBeUndefined();

    expect(harness.logger.error).toHaveBeenCalledWith("request_failed", {
      reason: "backend_close_failed",
    });
    expect(JSON.stringify(vi.mocked(harness.logger.error).mock.calls)).not.toContain(
      "sensitive sqlite path",
    );
    expect(harness.logger.info).not.toHaveBeenCalledWith("shutdown_completed");
    expect(harness.dependencies.exit).toHaveBeenCalledWith(1);
    await runtime.shutdown();
    expect(harness.backend.close).toHaveBeenCalledTimes(1);
  });
});
