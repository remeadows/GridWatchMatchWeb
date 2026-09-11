import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Mounted under /play/match/ so the same build serves on gridwatchmatchweb.warsignallabs.net
  // (worker/playPrefix.ts strips the prefix) and behind the Nexus /play/ proxy.
  base: "/play/match/",
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

