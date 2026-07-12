export type LogValue = string | number | boolean;
export type LogEvent =
  | "server_start"
  | "server_ready"
  | "cleanup_completed"
  | "cleanup_skipped"
  | "cleanup_failed"
  | "request_failed"
  | "shutdown_started"
  | "shutdown_completed";

export interface AppLogger {
  info(event: LogEvent, fields?: Record<string, LogValue>): void;
  error(event: LogEvent, fields?: Record<string, LogValue>): void;
}

const LOG_EVENTS: ReadonlySet<string> = new Set<LogEvent>([
  "server_start",
  "server_ready",
  "cleanup_completed",
  "cleanup_skipped",
  "cleanup_failed",
  "request_failed",
  "shutdown_started",
  "shutdown_completed",
]);

const ALLOWED_FIELDS = [
  "requestId",
  "backendType",
  "port",
  "intervalMs",
  "trigger",
  "deletedCount",
  "durationMs",
  "reason",
] as const;

function isLogValue(value: unknown): value is LogValue {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function assertLogEvent(event: string): asserts event is LogEvent {
  if (!LOG_EVENTS.has(event)) throw new TypeError("Unsupported log event");
}

function selectFields(fields: Record<string, LogValue> | undefined): Record<string, LogValue> {
  const selected: Record<string, LogValue> = {};
  if (!fields) return selected;

  for (const key of ALLOWED_FIELDS) {
    const value: unknown = fields[key];
    if (!isLogValue(value)) continue;
    if (
      key === "intervalMs"
      && (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < 0)
    ) continue;
    selected[key] = value;
  }
  return selected;
}

export function createJsonLogger(
  stdout: Pick<Console, "log"> = console,
  stderr: Pick<Console, "error"> = console,
  now: () => Date = () => new Date(),
): AppLogger {
  function write(
    level: "info" | "error",
    output: (line: string) => void,
    event: string,
    fields?: Record<string, LogValue>,
  ): void {
    assertLogEvent(event);
    const line = JSON.stringify({
      timestamp: now().toISOString(),
      level,
      event,
      ...selectFields(fields),
    });
    output(line);
  }

  return {
    info(event, fields) {
      write("info", stdout.log.bind(stdout), event, fields);
    },
    error(event, fields) {
      write("error", stderr.error.bind(stderr), event, fields);
    },
  };
}
