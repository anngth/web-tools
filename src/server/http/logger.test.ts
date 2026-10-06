import { describe, expect, it, vi } from "vitest";
import { createJsonLogger, type LogEvent } from "./logger";

const NOW = new Date("2026-07-12T03:04:05.006Z");
const OPERATIONAL_EVENTS = [
  "server_start",
  "server_ready",
  "cleanup_completed",
  "cleanup_skipped",
  "cleanup_failed",
  "request_failed",
  "shutdown_started",
  "shutdown_completed",
] as const;
type ExpectedLogEvent = typeof OPERATIONAL_EVENTS[number];
type IsExact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const LOG_EVENT_TYPE_IS_EXACT: IsExact<LogEvent, ExpectedLogEvent> = true;

function makeLogger() {
  const stdout = { log: vi.fn() };
  const stderr = { error: vi.fn() };
  const logger = createJsonLogger(stdout, stderr, () => NOW);
  return { logger, stdout, stderr };
}

describe("createJsonLogger", () => {
  it("writes one single-line JSON object to the stream for each level", () => {
    const { logger, stdout, stderr } = makeLogger();

    logger.info("server_ready", { backendType: "d1", port: 8080 });
    logger.error("request_failed", { requestId: "req-1", reason: "internal" });

    expect(stdout.log).toHaveBeenCalledTimes(1);
    expect(stderr.error).toHaveBeenCalledTimes(1);
    expect(stdout.log).toHaveBeenCalledWith(JSON.stringify({
      timestamp: NOW.toISOString(),
      level: "info",
      event: "server_ready",
      backendType: "d1",
      port: 8080,
    }));
    expect(stderr.error).toHaveBeenCalledWith(JSON.stringify({
      timestamp: NOW.toISOString(),
      level: "error",
      event: "request_failed",
      requestId: "req-1",
      reason: "internal",
    }));
    expect(stdout.log.mock.calls[0]).toHaveLength(1);
    expect(stderr.error.mock.calls[0]).toHaveLength(1);
    expect(stdout.log.mock.calls[0][0]).not.toContain("\n");
    expect(stderr.error.mock.calls[0][0]).not.toContain("\n");
  });

  it("supports the exact operational events and allowlisted scalar fields", () => {
    const { logger, stdout, stderr } = makeLogger();
    const events: readonly LogEvent[] = OPERATIONAL_EVENTS;

    expect(LOG_EVENT_TYPE_IS_EXACT).toBe(true);
    logger.info(events[0], {
      requestId: "req-1",
      backendType: "d1",
      port: 8080,
      intervalMs: 300_000,
      trigger: "startup",
      deletedCount: 2,
      durationMs: 17,
      reason: "complete",
      ignored: "drop-me",
    });
    for (const event of events.slice(1)) logger.error(event);

    expect(JSON.parse(stdout.log.mock.calls[0][0])).toEqual({
      timestamp: NOW.toISOString(),
      level: "info",
      event: "server_start",
      requestId: "req-1",
      backendType: "d1",
      port: 8080,
      intervalMs: 300_000,
      trigger: "startup",
      deletedCount: 2,
      durationMs: 17,
      reason: "complete",
    });
    expect(stderr.error.mock.calls.map(([line]) => JSON.parse(line).event)).toEqual(events.slice(1));
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5])(
    "drops invalid intervalMs %s",
    (intervalMs) => {
      const { logger, stdout } = makeLogger();

      logger.info("server_start", { intervalMs });

      expect(JSON.parse(stdout.log.mock.calls[0][0])).not.toHaveProperty("intervalMs");
    },
  );

  it("prevents caller fields from overriding the internally controlled envelope", () => {
    const { logger, stdout } = makeLogger();

    logger.info("server_ready", {
      timestamp: "attacker-time",
      level: "error",
      event: "attacker-event",
    } as Record<string, string>);

    expect(JSON.parse(stdout.log.mock.calls[0][0])).toEqual({
      timestamp: NOW.toISOString(),
      level: "info",
      event: "server_ready",
    });
  });

  it("throws a generic TypeError without output for unsupported events passed through an unsafe cast", () => {
    const { logger, stdout, stderr } = makeLogger();
    const unsafeLogger = logger as unknown as {
      info(event: string, fields?: Record<string, string>): void;
      error(event: string, fields?: Record<string, string>): void;
    };
    const sensitiveEvent = "destination_https://secret.example/token_secret-token";

    let thrown: unknown;
    try {
      unsafeLogger.error(sensitiveEvent, { requestId: "req-1" });
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TypeError);
    expect(String(thrown)).toBe("TypeError: Unsupported log event");
    expect(String(thrown)).not.toContain(sensitiveEvent);
    expect(stdout.log).not.toHaveBeenCalled();
    expect(stderr.error).not.toHaveBeenCalled();
    expect(JSON.stringify([stdout.log.mock.calls, stderr.error.mock.calls])).not.toContain("secret");
  });

  it("redacts prohibited sensitive fields from both output streams", () => {
    const { logger, stdout, stderr } = makeLogger();
    const sensitive = {
      destinationUrl: "https://secret.example/path",
      token: "secret-token",
      authorization: "Bearer secret-authorization",
      requestBody: "secret-request-body",
      databasePath: "/secret/database.sqlite",
      sql: "SELECT secret_sql",
      gatewayBody: "secret-gateway-body",
    };

    logger.info("server_start", { backendType: "postgres", ...sensitive } as Record<string, string>);
    logger.error("request_failed", {
      requestId: "req-1",
      reason: "internal",
      ...sensitive,
    } as Record<string, string>);

    const output = JSON.stringify([stdout.log.mock.calls, stderr.error.mock.calls]);
    expect(output).toContain("req-1");
    for (const value of Object.values(sensitive)) expect(output).not.toContain(value);
    const records = [stdout.log.mock.calls[0][0], stderr.error.mock.calls[0][0]].map(
      (line) => JSON.parse(line) as Record<string, unknown>,
    );
    for (const record of records) {
      for (const key of Object.keys(sensitive)) expect(record).not.toHaveProperty(key);
    }
  });

  it("keeps postgres fallback fields and redacts database url and sql", () => {
    const { logger, stdout } = makeLogger();

    logger.info("server_start", {
      backendType: "postgres",
      reason: "d1_unavailable",
      databaseUrl: "postgres://user:secret@localhost/db",
      sql: "SELECT secret",
    });

    const line = stdout.log.mock.calls[0][0] as string;
    const record = JSON.parse(line) as Record<string, unknown>;
    expect(record.backendType).toBe("postgres");
    expect(record.reason).toBe("d1_unavailable");
    expect(line).not.toContain("secret");
    expect(line).not.toContain("SELECT");
  });

  it("drops Error and unknown values without recursively inspecting or serializing them", () => {
    const { logger, stderr } = makeLogger();
    const unknownValue = Object.defineProperty({}, "secret", {
      enumerable: true,
      get: () => { throw new Error("recursed into unknown value"); },
    });
    const error = new Error("secret-error-message");
    Object.assign(error, { toJSON: () => { throw new Error("serialized Error"); } });

    expect(() => logger.error("request_failed", {
      requestId: "req-1",
      reason: error,
      destinationUrl: unknownValue,
    } as unknown as Record<string, string>)).not.toThrow();

    expect(JSON.parse(stderr.error.mock.calls[0][0])).toEqual({
      timestamp: NOW.toISOString(),
      level: "error",
      event: "request_failed",
      requestId: "req-1",
    });
  });
});
