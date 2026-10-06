import { mergeConfig } from "vite";
import { defineConfig } from "vitest/config";
import baseVitestConfig from "./vitest.config";

export default mergeConfig(
  baseVitestConfig,
  defineConfig({
    test: {
      exclude: [
        "src/worker/short-links/d1-store.test.ts",
        "src/worker/short-links/worker.test.ts",
        "node_modules/**",
        "dist/**",
      ],
    },
  }),
);
