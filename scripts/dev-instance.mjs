// Builds the game and uploads it to the DEV instance (wrangler.dev.jsonc), for play testing local commits.
// Russ, 2026-10-08: "create a dev test web site like I did with Drift and Skyhook".
// usage: npm run cf:dev-instance               build, then upload
//        npm run cf:dev-instance -- --dry-run  build, upload nothing
//
// It can never reach production: it uploads only with the dev config, and it refuses unless that config names the dev
// Worker and declares static files and nothing else (no Worker code, no binding, no route, no var, no cron).
// The build label is the commit's, so commit first: a label holding -dirty says the build is not a commit.
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const CONFIG = "wrangler.dev.jsonc";
const NAME = "gridwatch-match-dev";
const fail = (message) => {
  console.error(`dev-instance: ${message}`);
  process.exit(1);
};

const text = readFileSync(join(root, CONFIG), "utf8")
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");
const config = JSON.parse(text);
const allowed = new Set(["$schema", "name", "account_id", "compatibility_date", "assets", "workers_dev", "preview_urls", "send_metrics"]);
const allowedAssets = new Set(["directory", "not_found_handling"]);
if (config.name !== NAME) fail(`${CONFIG} must name ${NAME}, not ${config.name}`);
for (const key of Object.keys(config)) {
  if (!allowed.has(key)) fail(`${CONFIG} may not declare "${key}": the dev instance is static files only`);
}
for (const key of Object.keys(config.assets ?? {})) {
  if (!allowedAssets.has(key)) fail(`${CONFIG}: "assets" may not declare "${key}": no binding, no worker-first paths`);
}
if (config.assets?.directory !== "./dist") fail(`${CONFIG}: "assets.directory" must be ./dist`);

const capture = (command, args) => {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) fail(`${command} ${args.join(" ")} ended with ${result.status}`);
  return result.stdout.trim();
};
const run = (command, args, env = {}) => {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });
  if (result.status !== 0) fail(`${command} ${args.join(" ")} ended with ${result.status}`);
};

const commit = capture("git", ["rev-parse", "--short", "HEAD"]);
const dirty = capture("git", ["status", "--porcelain", "--untracked-files=no"]) === "" ? "" : "-dirty";
const label = `${commit}${dirty}-dev`;

// VITE_DEV_INSTANCE moves the build to the host root, shows the label, and stops the client posting scores.
// VITE_BOARD_THEME makes the work-in-progress dark-realism board art the default here (?theme=classic for the old).
run("npm", ["run", "build"], { VITE_DEV_INSTANCE: "1", VITE_BUILD_LABEL: label, VITE_BOARD_THEME: "darkRealism" });

const index = readFileSync(join(root, "dist", "index.html"), "utf8");
if (index.includes("/play/match/")) fail("dist/index.html still points under /play/match/: this is not a dev-instance build");

// A play-test host is not for search engines.
writeFileSync(join(root, "dist", "_headers"), "/*\n  X-Robots-Tag: noindex, nofollow\n");

if (process.argv.includes("--dry-run")) {
  console.log(`dev-instance: dry run of ${label}, nothing uploaded`);
  process.exit(0);
}
run("npx", ["wrangler", "deploy", "--config", CONFIG]);
console.log(`dev-instance: uploaded ${label}`);
