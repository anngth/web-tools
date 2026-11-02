import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker, { type WorkerEnv } from "./main";

const workerEnv = {
  ...env,
  ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
} as unknown as WorkerEnv;

async function insertLink(slug: string, expiresAt: string) {
  await env.DB.prepare(`
    INSERT INTO short_links (id, slug, destination_url, created_at, expires_at)
    VALUES (?, ?, 'https://example.com', '2026-07-01T00:00:00.000Z', ?)
  `)
    .bind(`id-${slug}`, slug, expiresAt)
    .run();
}

describe("Worker entry", () => {
  it("keeps the token-protected gateway under /internal", async () => {
    const ctx = createExecutionContext();
    const response = await worker.fetch(
      new Request("https://tools.example.com/internal/health"),
      workerEnv,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(401);
  });

  it("serves public routes without the gateway token", async () => {
    const ctx = createExecutionContext();
    const response = await worker.fetch(
      new Request("https://tools.example.com/healthz"),
      workerEnv,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("deletes expired links and rate limit windows on the cron trigger", async () => {
    await insertLink("old", "2026-07-12T00:00:00.000Z");
    await insertLink("live", "2026-07-13T00:00:00.000Z");
    await env.DB.prepare(
      "INSERT INTO rate_limit_windows (client_key, window_ms, reset_at, count) VALUES ('ip', 60000, ?, 1)",
    )
      .bind(Date.parse("2026-07-11T23:59:00.000Z"))
      .run();

    const ctx = createExecutionContext();
    worker.scheduled(
      { scheduledTime: Date.parse("2026-07-12T00:00:00.000Z"), cron: "*/5 * * * *", noRetry() {} },
      workerEnv,
      ctx,
    );
    await waitOnExecutionContext(ctx);

    const links = await env.DB.prepare("SELECT slug FROM short_links").all();
    expect(links.results).toEqual([{ slug: "live" }]);
    const windows = await env.DB.prepare("SELECT COUNT(*) AS count FROM rate_limit_windows")
      .first<{ count: number }>();
    expect(windows?.count).toBe(0);
  });
});
