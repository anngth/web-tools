import { mergeConfig } from "vite";
import { defineConfig } from "vitest/config";
import baseVitestConfig from "./vitest.config";

export default mergeConfig(
  baseVitestConfig,
  defineConfig({
    test: {
      exclude: [
        "src/worker/**",
        "node_modules/**",
        "dist/**",
      ],
    },
  }),
);
