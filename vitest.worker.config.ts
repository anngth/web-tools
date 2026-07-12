import { defineConfig } from "vitest/config";

process.env.WRANGLER_LOG_PATH = "/tmp/web-tools-wrangler.log";

const { cloudflareTest, readD1Migrations } = await import(
  "@cloudflare/vitest-pool-workers"
);

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        d1Databases: { DB: "url-shortener-test" },
        bindings: {
          GATEWAY_TOKEN: "test-secret",
          TEST_MIGRATIONS: await readD1Migrations(
            "src/features/url-shortener/backend/migrations",
          ),
        },
      },
    })),
  ],
  test: {
    include: [
      "src/features/url-shortener/backend/d1-store.test.ts",
      "src/features/url-shortener/backend/worker.test.ts",
    ],
    setupFiles: [
      "src/features/url-shortener/backend/worker-test.setup.ts",
    ],
  },
});
