import { mergeConfig } from "vite";
import { defineConfig } from "vitest/config";
import baseVitestConfig from "./vitest.config";

export default mergeConfig(
  baseVitestConfig,
  defineConfig({
    test: {
      exclude: [
        "src/features/url-shortener/backend/d1-store.test.ts",
        "src/features/url-shortener/backend/worker.test.ts",
        "node_modules/**",
        "dist/**",
      ],
    },
  }),
);
