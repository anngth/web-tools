import type { AppLogger } from "./logger";
import type { ShortLinkBackend } from "./short-link-backend";

const CLEANUP_INTERVAL_MS = 300_000 as const;

type CleanupTrigger = "startup" | "scheduled";

export interface CleanupController {
  run(trigger: CleanupTrigger): Promise<void>;
  start(): void;
  stop(): void;
  waitForIdle(): Promise<void>;
}

export function createCleanupController(options: {
  backend: ShortLinkBackend;
  logger: AppLogger;
  now?: () => Date;
  intervalMs?: 300_000;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}): CleanupController {
  const {
    backend,
    logger,
    now = () => new Date(),
    intervalMs = CLEANUP_INTERVAL_MS,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
  } = options;
  let active: Promise<void> | undefined;
  let intervalId: ReturnType<typeof setInterval> | undefined;

  function durationSince(startedAt: number): number {
    return Math.max(0, Math.round(performance.now() - startedAt));
  }

  function run(trigger: CleanupTrigger): Promise<void> {
    if (active) {
      logger.info("cleanup_skipped", { trigger });
      return Promise.resolve();
    }

    const startedAt = performance.now();
    let operation: Promise<void>;
    operation = Promise.resolve()
      .then(async () => {
        try {
          const deletedCount = await backend.deleteExpired(now());
          logger.info("cleanup_completed", {
            trigger,
            deletedCount,
            durationMs: durationSince(startedAt),
          });
        } catch {
          logger.error("cleanup_failed", {
            trigger,
            durationMs: durationSince(startedAt),
          });
        }
      })
      .finally(() => {
        if (active === operation) active = undefined;
      });
    active = operation;
    return operation;
  }

  return {
    run,
    start() {
      if (intervalId !== undefined) return;
      intervalId = setIntervalFn(() => {
        void run("scheduled");
      }, intervalMs);
    },
    stop() {
      if (intervalId === undefined) return;
      clearIntervalFn(intervalId);
      intervalId = undefined;
    },
    waitForIdle() {
      return active ?? Promise.resolve();
    },
  };
}
