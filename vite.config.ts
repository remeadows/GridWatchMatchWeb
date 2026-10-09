import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Mounted under /play/match/ so the same build serves on gridwatchmatchweb.warsignallabs.net
  // (worker/playPrefix.ts strips the prefix) and behind the Nexus /play/ proxy.
  // The dev instance (wrangler.dev.jsonc) is static files with no worker to strip a prefix, so
  // `npm run cf:dev-instance` builds for the host root instead.
  base: process.env.VITE_DEV_INSTANCE === "1" ? "/" : "/play/match/",
  plugins: [react()],
  build: {
    modulePreload: {
      polyfill: false
    }
  },
  test: {
    environment: "node"
  }
});

