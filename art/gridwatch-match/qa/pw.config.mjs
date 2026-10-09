// Runs the repo's own e2e suite with the installed Chrome (the bundled browsers for this Playwright
// version are not downloaded on this Mac). GW_THEME=darkRealism builds with the dark board as default.
import { createRequire } from "node:module";
const repo = process.env.GW_REPO;
const out = process.env.GW_OUT;
const { devices } = createRequire(repo + "/package.json")("@playwright/test");
export default {
  testDir: repo + "/tests/e2e",
  timeout: 30_000,
  workers: 1,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  reporter: [["line"], ["json", { outputFile: out + "/report.json" }]],
  outputDir: out + "/results",
  use: { baseURL: "http://127.0.0.1:4173/play/match/", trace: "off", screenshot: "only-on-failure" },
  webServer: {
    command: "npm run build && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort",
    cwd: repo,
    url: "http://127.0.0.1:4173/play/match/",
    reuseExistingServer: false,
    timeout: 180_000,
    env: { VITE_NEXUS_ORIGIN: "http://127.0.0.1:4173", VITE_CARRY_TEST_ORIGIN: "http://localhost:4173", VITE_BOARD_THEME: process.env.GW_THEME ?? "" },
  },
  projects: [
    // GW_BUNDLED=1: the repo's real projects (bundled Chromium, and WebKit for the iPhone 15 project).
    ...(process.env.GW_BUNDLED === "1"
      ? [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }, { name: "mobile", use: { ...devices["iPhone 15"] } }]
      : [
          { name: "chromium", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
          { name: "mobile", use: { ...devices["iPhone 15"], browserName: "chromium", channel: "chrome" } },
        ]),
  ],
};
