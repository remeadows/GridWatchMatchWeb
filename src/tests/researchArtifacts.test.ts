import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

it("creates a distinct private directory for each baseline capture run", () => {
  const parent = mkdtempSync(join(tmpdir(), "gridwatch-capture-contract-"));
  const source = readFileSync("docs/research/2026-09-08-game-feel/baseline-browser.cjs", "utf8");
  const setup = source.slice(0, source.indexOf("\nasync function gesture"));
  const require = createRequire(import.meta.url);
  const allocate = () => runInNewContext(`${setup}\nout`, {
    require: (id: string) => id === "@playwright/test" ? {} : require(id),
    process: { env: { GW_CAPTURE_DIR: parent } }
  }) as string;
  try {
    const first = allocate(), second = allocate();
    expect(dirname(first)).toBe(parent);
    expect(second).not.toBe(first);
    expect(statSync(first).mode & 0o777).toBe(0o700);
    expect(statSync(second).mode & 0o777).toBe(0o700);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

it("keeps portable board-audio capture outputs private and rejects unsafe invocation arguments", () => {
  const parent = mkdtempSync(join(tmpdir(), "gridwatch-audio-contract-"));
  const helper = resolve("docs/research/2026-09-08-game-feel/board-audio-capture.cjs");
  const require = createRequire(import.meta.url);
  try {
    const source = readFileSync(helper, "utf8");
    const setup = source.slice(0, source.indexOf("\nconst specimens"));
    const allocate = (args = ["4176", "review", "muted"]) => runInNewContext(`${setup}\nout`, {
      require: (id: string) => id === "@playwright/test" ? {} : require(id),
      __dirname: dirname(helper),
      process: { env: { GW_CAPTURE_DIR: parent }, argv: ["node", helper, ...args] }
    }) as string;
    const first = allocate(), second = allocate();
    expect(dirname(first)).toBe(parent);
    expect(second).not.toBe(first);
    expect(statSync(first).mode & 0o777).toBe(0o700);
    expect(statSync(second).mode & 0o777).toBe(0o700);
    expect(() => allocate(["70000", "review"])).toThrow("port");
    expect(() => allocate(["4176", "../escape"])).toThrow("label");
    expect(() => allocate(["4176", "review", "loud"])).toThrow("muted");
  } finally { rmSync(parent, { recursive: true, force: true }); }
});
