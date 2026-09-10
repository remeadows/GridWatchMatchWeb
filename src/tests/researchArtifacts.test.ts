import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";
import ts from "typescript";

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
    const boundary = source.indexOf("\nconst specimens");
    expect(boundary).toBeGreaterThan(0);
    const setup = source.slice(0, boundary);
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

function captureCallArgument(method: string, index = 0, containing = "") {
  const source = readFileSync("docs/research/2026-09-08-game-feel/board-audio-capture.cjs", "utf8");
  const tree = ts.createSourceFile("capture.cjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const matches: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === method && node.getText(tree).includes(containing)) matches.push(node);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  expect(matches).toHaveLength(1);
  const argument = matches[0].arguments[index];
  expect(argument).toBeDefined();
  return argument.getText(tree);
}

function recordingHarness(failure?: "error" | "abort") {
  const bytes = new Uint8Array([0, 255, 128, 10, 64]);
  class Reader {
    result = `data:audio/webm;base64,${Buffer.from(bytes).toString("base64")}`;
    error = new Error("Recording read failed");
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    readAsDataURL() {
      if (failure === "error") this.onerror?.();
      else if (failure === "abort") this.onabort?.();
      else this.onload?.();
    }
  }
  class Recorder {
    onstop: (() => void) | null = null;
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    start() {}
    stop() { this.ondataavailable?.({ data: new Blob([bytes]) }); this.onstop?.(); }
  }
  class Context {
    createMediaStreamDestination() { return { stream: {} }; }
    async decodeAudioData() { return {}; }
    createGain() {}
    createDynamicsCompressor() {}
    createBufferSource() {}
  }
  const window = { AudioContext: Context, __audioCapture: undefined as undefined | { stop: () => Promise<unknown> } };
  runInNewContext(`(${captureCallArgument("addInitScript", 0, "Native")})()`, {
    window, MediaRecorder: Recorder, FileReader: Reader, Blob, performance
  });
  new window.AudioContext();
  expect(window.__audioCapture).toBeDefined();
  return { state: window.__audioCapture!, bytes };
}

it("transfers captured binary audio as base64 without changing its bytes", async () => {
  const { state, bytes } = recordingHarness();
  const encoded = await state.stop();
  expect(typeof encoded).toBe("string");
  expect(Buffer.from(String(encoded), "base64")).toEqual(Buffer.from(bytes));
});

it.each(["error", "abort"] as const)("rejects recording transfer on FileReader %s", async failure => {
  const { state } = recordingHarness(failure);
  await expect(state.stop()).rejects.toThrow();
});

it("waits for the manifest-derived decode count as well as board readiness", () => {
  const parent = mkdtempSync(join(tmpdir(), "gridwatch-audio-manifest-"));
  const helper = resolve("docs/research/2026-09-08-game-feel/board-audio-capture.cjs");
  const source = readFileSync(helper, "utf8");
  const boundary = source.indexOf("\nconst specimens");
  expect(boundary).toBeGreaterThan(0);
  const require = createRequire(import.meta.url);
  const manifest = Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`cue${index}`, `cue${index}.mp3`]));
  const manifestRead = vi.fn(() => ({ presentationAudioManifest: manifest }));
  const window = { __gwBoardReady: true, __audioCapture: { decoded: 20 } };
  const context = {
    require: (id: string) => id.endsWith("presentationAssets.ts") ? manifestRead()
      : id === "@playwright/test" ? {} : require(id),
    __dirname: dirname(helper), process: { env: { GW_CAPTURE_DIR: parent }, argv: ["node", helper] }, window
  };
  try {
    const predicate = captureCallArgument("waitForFunction", 0, "decoded");
    const expectedCount = captureCallArgument("waitForFunction", 1, "decoded");
    const ready = () => runInNewContext(`${source.slice(0, boundary)}\n(${predicate})(${expectedCount})`, { ...context });
    expect(ready()).toBe(false);
    window.__audioCapture.decoded = 21;
    expect(ready()).toBe(true);
    window.__gwBoardReady = false;
    expect(ready()).toBe(false);
    expect(manifestRead).toHaveBeenCalled();
  } finally { rmSync(parent, { recursive: true, force: true }); }
});
