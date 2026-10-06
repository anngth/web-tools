import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppLogger } from "./logger";
import type { ShortLinkBackend } from "../../shared/short-links/short-link-backend.ts";
import { createCleanupController } from "./cleanup-scheduler";

const START = new Date("2026-07-12T00:00:00.000Z");

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makeDependencies(deleteExpired = vi.fn<ShortLinkBackend["deleteExpired"]>()) {
  const backend = { deleteExpired } as unknown as ShortLinkBackend;
  const logger: AppLogger = { info: vi.fn(), error: vi.fn() };
  return { backend, deleteExpired, logger };
}

describe("createCleanupController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("makes startup cleanup completion awaitable", async () => {
    const deletion = deferred<number>();
    const { backend, deleteExpired, logger } = makeDependencies(
      vi.fn(() => deletion.promise),
    );
    const controller = createCleanupController({ backend, logger });
    let completed = false;

    const run = controller.run("startup").then(() => { completed = true; });
    await Promise.resolve();

    expect(deleteExpired).toHaveBeenCalledWith(START);
    expect(completed).toBe(false);

    deletion.resolve(3);
    await run;

    expect(completed).toBe(true);
    expect(logger.info).toHaveBeenCalledWith("cleanup_completed", {
      trigger: "startup",
      deletedCount: 3,
      durationMs: 0,
    });
  });

  it("schedules cleanup at exactly 300000 milliseconds", async () => {
    const { backend, deleteExpired, logger } = makeDependencies(vi.fn().mockResolvedValue(0));
    const setIntervalSpy = vi.fn((callback: () => void, delay: number) => (
      setInterval(callback, delay)
    ));
    const controller = createCleanupController({
      backend,
      logger,
      setIntervalFn: setIntervalSpy as unknown as typeof setInterval,
    });

    controller.start();

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 300_000);
    await vi.advanceTimersByTimeAsync(299_999);
    expect(deleteExpired).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(deleteExpired).toHaveBeenCalledTimes(1);
    expect(deleteExpired).toHaveBeenCalledWith(new Date("2026-07-12T00:05:00.000Z"));
  });

  it("skips and logs a scheduled tick while one cleanup promise is active", async () => {
    const deletion = deferred<number>();
    const { backend, deleteExpired, logger } = makeDependencies(vi.fn(() => deletion.promise));
    const controller = createCleanupController({ backend, logger });

    controller.start();
    await vi.advanceTimersByTimeAsync(300_000);
    await vi.advanceTimersByTimeAsync(300_000);

    expect(deleteExpired).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith("cleanup_skipped", { trigger: "scheduled" });

    deletion.resolve(1);
    await controller.waitForIdle();
  });

  it("logs a generic cleanup failure without rejecting and retries on the next tick", async () => {
    const sensitiveError = new Error("secret database path and SQL");
    const { backend, deleteExpired, logger } = makeDependencies(
      vi.fn()
        .mockRejectedValueOnce(sensitiveError)
        .mockResolvedValueOnce(2),
    );
    const controller = createCleanupController({ backend, logger });

    controller.start();
    await vi.advanceTimersByTimeAsync(300_000);

    expect(logger.error).toHaveBeenCalledWith("cleanup_failed", {
      trigger: "scheduled",
      durationMs: 0,
    });
    expect(logger.error).not.toHaveBeenCalledWith(
      "cleanup_failed",
      expect.objectContaining({ error: sensitiveError }),
    );
    for (const call of vi.mocked(logger.error).mock.calls) {
      expect(call).not.toContain(sensitiveError);
      for (const argument of call) {
        if (typeof argument === "object" && argument !== null) {
          expect(Object.values(argument)).not.toContain(sensitiveError);
        }
      }
    }
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain(sensitiveError.message);

    await vi.advanceTimersByTimeAsync(300_000);

    expect(deleteExpired).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith("cleanup_completed", {
      trigger: "scheduled",
      deletedCount: 2,
      durationMs: 0,
    });
  });

  it("uses monotonic elapsed time even when the wall clock moves backward", async () => {
    const deletion = deferred<number>();
    const { backend, logger } = makeDependencies(vi.fn(() => deletion.promise));
    const controller = createCleanupController({ backend, logger });
    const run = controller.run("startup");

    vi.setSystemTime(new Date("2020-01-01T00:00:00.000Z"));
    await vi.advanceTimersByTimeAsync(37);
    deletion.resolve(1);
    await run;

    expect(logger.info).toHaveBeenCalledWith("cleanup_completed", {
      trigger: "startup",
      deletedCount: 1,
      durationMs: 37,
    });
  });

  it("clears its single timer only once when stopped repeatedly", () => {
    const { backend, logger } = makeDependencies();
    const intervalId = 42;
    const setIntervalSpy = vi.fn(() => intervalId);
    const clearIntervalSpy = vi.fn();
    const controller = createCleanupController({
      backend,
      logger,
      setIntervalFn: setIntervalSpy as unknown as typeof setInterval,
      clearIntervalFn: clearIntervalSpy as unknown as typeof clearInterval,
    });

    controller.start();
    controller.start();
    controller.stop();
    controller.stop();

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    expect(clearIntervalSpy).toHaveBeenCalledWith(intervalId);
  });

  it("waitForIdle resolves only after the active deletion settles", async () => {
    const deletion = deferred<number>();
    const { backend, logger } = makeDependencies(vi.fn(() => deletion.promise));
    const controller = createCleanupController({ backend, logger });
    let idle = false;

    void controller.run("startup");
    const waiting = controller.waitForIdle().then(() => { idle = true; });
    await Promise.resolve();
    expect(idle).toBe(false);

    deletion.resolve(0);
    await waiting;

    expect(idle).toBe(true);
  });
});
