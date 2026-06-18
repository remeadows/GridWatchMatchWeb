import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Served from the root of GridWatchMatchWeb.warsignallabs.net (Cloudflare Pages),
  // so assets resolve at the host root.
  base: "/",
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

