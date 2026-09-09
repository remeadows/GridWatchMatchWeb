# Audit Reproduction

## Frozen Implementation Baseline

Task 0 fixtures live in `src/tests/fixtures/resolution/`. `manifest.json` contains
SHA-256 source hashes; `corpus.json` stores 2,000 runs / 34,054 actions, action
tuples, and complete canonical outcome hashes. Arrays preserve order; object keys
sort recursively. Each outcome includes delta, error, complete row-major snapshot,
and cumulative action log. `specimens.json` retains full authored input, initial
state, the last action's before/after state, and expected outcome for 21 cases.

```bash
node --experimental-transform-types docs/research/2026-09-08-game-feel/verify-resolution.mjs
```

Verification writes nothing. `freeze-resolution.mjs` is provenance only: it checks
every source byte against `328a1a7` and refuses to overwrite existing fixtures.
Never regenerate expected outcomes from a changed engine. An initial unpublished
specimen draft retained a mutable action-array reference; it was quarantined outside
source and corrected before the no-write replay gate. Corpus hashes did not change.

Creation/activation at one coordinate alone is ambiguous. The specimens separately
name coordinate reuse and creation followed by a later tap; they do not claim a
same-action created-then-consumed power-up without stage/identity evidence.

With the baseline preview on 4174, run `baseline-browser.cjs` for videos, before/
impact/settled screenshots, and actual scene traces in
`/tmp/gridwatch-resolution-baseline-20260908/` (`GW_CAPTURE_DIR` can override).
Unlike the original audit below, this uses WebKit for the iPhone 15 project.
Combo captures are preview-only; singles and normal/cascade captures are real
engine actions. The script uses isolated guest contexts. Sticky header overlap
can occur in scrolled canvas screenshots; retain videos for full sequence context.

## Original Screening

These are research scripts for the September 8 plan, not production gameplay code
or a finished balance-testing tool. They use existing project dependencies and
Node 24's TypeScript stripping/module hooks. Run from a checkout with dependencies
installed. The recorded engine and level sources are equivalent on `2dbea72` and
`328a1a7`; later behavior changes require a newly labeled audit.

```bash
node docs/research/2026-09-08-game-feel/balance-screen.mjs
node docs/research/2026-09-08-game-feel/balance-screen.mjs --production-seed
```

Each command simulates 4,000 runs. It creates a private, randomized directory
named `gridwatch-balance-*` inside the operating system's temporary directory.
The sensitivity command writes `sensitivity.json`; `--production-seed` writes
`production.json`. Use the exact path printed as `Report: <path>` when the run
finishes. Every run gets a new directory and exclusively creates its report.
The seed field in the original saved examples is the chooser seed; production
examples use `levelSeed(level.id)` for the board.
The reproduction script also labels engineSeed explicitly. No application data,
public levels, browser saves, or external APIs are modified by balance screening.

`balance-summary.csv` has 100 per-level rows from the completed runs, and
`summary.json` retains action totals and replay examples. Medians use the upper
middle observed value for an even sample count. See the audit report for policy
weights and limitations. This screen does not model thinking time or boss clocks.

For the browser audit, build the application and start a dedicated preview:

```bash
npm run build
npm run preview -- --host 127.0.0.1 --port 4174 --strictPort
```

In another terminal:

```bash
node docs/research/2026-09-08-game-feel/browser-screen.cjs
```

It uses isolated Playwright contexts and test mode; no signed-in account is used.
The mobile run is a narrow Chromium viewport, not Safari or physical-device testing.
PNG captures and `traces.json` are written in a private, randomized
`gridwatch-feel-audit-*` directory inside the operating system's temporary directory.
Use the exact directory printed as `Capture directory: <path>` at startup.
Positive contact offsets mean the piece broke late; negative offsets mean early.
Results vary with frame scheduling; they are
diagnostic observations, not performance percentiles or acceptance assertions.

Temporary scripts/outputs used for the original audit remain outside Git. Their
portable equivalents are retained here so findings can be reproduced after a
context handoff. Task 11 in the plan adds formal policy tests, confidence intervals,
more samples, source hashes, and boss/animation-time analysis.
