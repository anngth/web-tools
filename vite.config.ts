import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8080",
      // Prefix "/s" also matches Vite's "/src" modules. Only short-link paths proxy.
      "^/s/": "http://127.0.0.1:8080",
    },
  },
});
