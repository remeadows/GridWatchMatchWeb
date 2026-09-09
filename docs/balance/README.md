# Campaign Balance Screening

This is an offline diagnostic, not a player model, automatic level generator, or
authorization to change production content. Canonical levels, engine outcomes,
score formulas, Worker validation, and player saves are unchanged.

Temporary evidence paths below are author-local, transient artifacts, not shared
review attachments. They may disappear during OS cleanup. Retained SHA-256 digests
identify the historical files; reproduce reports using the commands here.

## Reproduction

Use the repository's pinned Node 24 runtime and existing installed dependencies.
The script uses Node's native TypeScript transform and resolver hooks; it does not
bundle a second engine or install a runtime loader.

```bash
node --experimental-transform-types scripts/analyze-balance.mjs --samples 100
node --experimental-transform-types scripts/analyze-balance.mjs --samples 500 --levels 19,35,49,50,51,60,61,70
```

Each command prints `Report: <path>` in a new private randomized temporary
directory. `--output <path>` selects an explicit destination and refuses to
overwrite an existing file. Reports contain no wall-clock timestamps or absolute
source paths, so identical inputs and sources produce byte-identical JSON.

Optional `--policies random,visible-match,objective-aware` and
`--cohorts production,sensitivity` select subsets. The default full baseline is
100 levels x 100 seeds x three policies x two cohorts = 60,000 runs. The eight-level
500-seed screen is 24,000 runs. Use fresh output paths when comparing repeats.

`baseline.json` records the all-level screen. Its `sources` map pins the analyzer,
every engine module, all canonical level JSON, all Worker TypeScript/JSON, the app's
retry-seed function, and relevant presentation sources. The CLI hashes those files
before and after analysis and rejects a report if they change during the run.
Experimental native-transform warnings are expected on Node 24.

## Policies And Cohorts

- `random`: uniform choice among both directions of every engine-reported legal
  swap and each power-up tap once. Ordered endpoints are deduplicated. Reversing
  a drag can change the match-created power-up's destination, so all policies
  consider both directions and initial legal-choice metrics count them separately.
  It is not a model of random screen taps or the time a person needs to find moves.
- `visible-match`: estimates immediate visible clears and potential match-created
  power-ups. It does not simulate future refill or subsequent cascades.
- `objective-aware`: additionally favors remaining collection/clear objectives,
  blockers, locks, underlays, and supported guide/spread objectives. Heuristic
  weights are explicit in the script, not fitted human behavior.

Both nonrandom policies inspect a cloned visible board and reuse the engine's
immediate match/power-up footprint helpers. Uncertain power-up targets use a fixed
independent sampler (`0xbeef`), not the engine RNG state. That sampled footprint is
an approximation, not foresight. Ties use the separate policy RNG. No policy reads
future draws, spends tray boosters, uses Play On, or submits scores/telemetry.

Production runs use the actual `levelSeed(level.id)` retry seed for every attempt;
policy seeds are `100001..100100` for the baseline. Sensitivity runs pair engine
seeds `1..100` with those policy seeds. The larger screen extends both lists to
500. Fixed production retry seeds are an existing design choice: changing them
would be a separate gameplay decision.

Runs stop at the first terminal delta or authored move budget. Unknown policies,
injected booster actions, duplicate objective IDs, engine exceptions, and failure
to reach a terminal state throw errors rather than becoming ordinary losses.
Successful reports therefore record zero errors/rejections. No arbitrary cascade
cutoff is introduced.

## Metrics And Limitations

Each level/cohort/policy includes sample count, wins, Wilson 95% interval, engine
and policy seed lists, and min/p10/median/p90/max/mean distributions for:

- Used/unused moves and unused fraction, initial legal choices, actual clears.
- Power-up creations, distinct nonrepeat activations, reshuffle events, maximum
  cascade depth, and estimated forced-presentation duration.
- Remaining quantity for each authored objective.

Wilson intervals summarize these conditional bot samples. Board/action seeds are
deterministic, policies share structural bias, and sensitivity seeds are paired;
the intervals are not a human success forecast or proof of independent trials.

Presentation duration is a nominal ordered-phase estimate using current pure
timing helpers, identity-based gravity/refill distances, connected match pacing,
and power-up resource budgets. Scene-local creation (310 ms) and spawn premium
(40 ms) are explicitly recorded, with `BoardScene.ts` hashed for auditability.
Budgets are not measured effect completion times. The model excludes frame stalls,
audio output latency, user pauses, navigation, and cosmetic cleanup after handoff.
It does not replace browser trace/performance evidence.

Each of the ten bosses retains its authored timer. Separate models charge 1, 3, 5,
or 8 seconds of thinking plus 0.25 seconds of gesture time per move. Raw move wins
are reported independently of clock-limited modeled wins. In the Task 5 candidate,
forced playback and hidden-page time do not consume the visible-controllable-time
clock. Estimated wall time adds forced presentation and a 2.5-second winning ending;
neither is deducted from the boss clock. This is the explicit candidate clock rule,
not unchanged iOS timing parity or measured human thinking time.

## Flags And Candidate Boundaries

Flags identify post-tutorial production-random wins >=95%, median unused moves
above 40%, neighboring changes >=25 percentage points in random wins or median
unused fraction, unrecognized objective IDs, and collection types absent from
initial/spawn content. The last check is conservative, not a complete solvability
proof. Global mechanic coverage above 65% is an overuse review signal, not an error.

Review Levels 19, 35, 49, 50, 51, 60, 61, and 70 first, retaining Levels 1-3 and
representative untuned controls. A later candidate changes only explicitly chosen
move budgets and only in an isolated development preview. No global percentage
cut, new board generation, canonical JSON edit, backend change, or live-save write
is permitted by this analysis. Bot results select hypotheses; actual local human
sessions must establish fairness and content acceptance.

## Verification

The focused unit regressions exercise the exact CLI loader and exports:
independent deterministic choices, first-terminal stop, authored move limit,
invalid input, fail-loud engine errors, Wilson intervals, repeatable cohort output,
and separate boss controllable/forced time. The frozen all-level engine corpus
remains the engine-outcome regression gate.

## Historical September 9 One-Direction Baseline

This section records the superseded one-direction analyzer results and their
original digests. They are retained as provenance, not current screening evidence.
The checked-in reports now use both drag directions; see the corrected rescreen
below before evaluating a candidate.

The full baseline completed 60,000 runs and 772,840 legal actions with zero engine
errors or rejected actions. No protected source changed during analysis.
`baseline.json` SHA-256:
`49355e1905ba629b089200ddf53bcafc112afb0f0306a98766f5aca761611731`.

| Cohort | Random wins / 10,000 | Visible-match wins / 10,000 | Objective-aware wins / 10,000 |
|---|---:|---:|---:|
| Production | 9,835 (98.35%) | 9,991 (99.91%) | 10,000 (100%) |
| Sensitivity | 9,842 (98.42%) | 9,989 (99.89%) | 9,997 (99.97%) |

Ninety post-tutorial levels trigger the >=95% production-random win flag; 73 levels
have median unused moves above 40%. Eight adjacent pairs show large unused-move
jumps and two show large win-rate jumps. No unrecognized/unreachable collection
objectives were flagged. Locks occur in 68 levels, overlays in 77, underlays in 80,
generators in 17, and initial power-ups in 11. These coverage signals do not prove
mechanics are uninteresting or that every objective is solvable.

| Pilot | Authored moves | Production random wins | Random median used | Visible median used | Objective-aware median used |
|---|---:|---:|---:|---:|---:|
| 19 | 19 | 94% | 13 | 5 | 6 |
| 35 | 18 | 75% | 16.5 | 13 | 12 |
| 49 | 24 | 99% | 15.5 | 10 | 13 |
| 50 | 27 | 68% | 25 | 16 | 24 |
| 51 | 44 | 100% | 14 | 10 | 12 |
| 60 | 38 | 100% | 22 | 16 | 15 |
| 61 | 48 | 100% | 16 | 12 | 12 |
| 70 | 39 | 100% | 24 | 19 | 15.5 |

Levels 35 and 50 already constrain random legal play; a blanket move-budget cut
would worsen those spikes. Levels 51 and 61 have substantially more slack despite
the later five-color boards. Evaluate specific moves-only hypotheses after the
500-seed outlier screen, rather than applying a campaign-wide percentage reduction.

Boss examples show why raw move outcome and thinking-time outcome must remain
separate. At 3 seconds thinking + 0.25 seconds gesture, production-random modeled
wins are 98% on Level 10, 68% on Level 50, and 45% on Level 70; raw wins are 100%,
68%, and 100%. At 5 seconds thinking, those modeled wins fall to 58%, 13%, and 5%.
The corresponding authored timers remain 60, 90, and 75 seconds. These are model
sensitivities, not measured playtest difficulty.

The full repeat completed in 591.76 seconds with the same 60,000 runs and 772,840
actions. `cmp` confirms byte-identical JSON, including every metric and all 121
source hashes. Repeat artifact:
`/var/folders/34/jr0n1ps531348kntshnbv8rm0000gn/T/gridwatch-balance-regression-qjqzQY/report.json`.
The eight-level 500-seed screen completed 24,000 runs / 357,507 actions with zero
errors/rejections in 350.22 seconds. Its full report is retained at
`/var/folders/34/jr0n1ps531348kntshnbv8rm0000gn/T/gridwatch-balance-regression-FHkxw5/report.json`,
SHA-256 `99e53bc4f8777b5daadf44bab016f9f99f0fc941b1a273d5e27534c57c27647e`.
It uses the same 121 source hashes as the all-level baseline.

| Pilot | Production random wins / 500 | Wilson 95% | Sensitivity random wins / 500 | Wilson 95% | Production visible / objective wins |
|---|---:|---|---:|---|---|
| 19 | 481 | 94.1-97.6% | 494 | 97.4-99.4% | 500 / 500 |
| 35 | 353 | 66.5-74.4% | 379 | 71.9-79.3% | 474 / 500 |
| 49 | 495 | 97.7-99.6% | 483 | 94.6-97.9% | 500 / 500 |
| 50 | 343 | 64.4-72.5% | 362 | 68.3-76.1% | 483 / 500 |
| 51 | 500 | 99.2-100% | 500 | 99.2-100% | 500 / 500 |
| 60 | 499 | 98.9-100% | 500 | 99.2-100% | 500 / 500 |
| 61 | 500 | 99.2-100% | 500 | 99.2-100% | 500 / 500 |
| 70 | 499 | 98.9-100% | 488 | 95.9-98.6% | 500 / 500 |

Production-random median used moves are 13, 16, 15.5, 25, 15, 21, 16, and 24
respectively. The direction of the initial pilot hypotheses is unchanged. Large
differences between policy results, including deterministic single-path cohorts,
are a reason to retain human playtests, not to claim highly precise player rates.

## Isolated Local Pilot

`candidates/pilot-moves-v1.json` is the explicit content hypothesis, not accepted
canonical content. It changes only these move limits:

| Level | Canonical | Local trial | Reason |
|---|---:|---:|---|
| 19 | 19 | 17 | Modest two-move trim near production-random p90 |
| 35 | 18 | 19 | One-move relief at a demonstrated difficulty spike |
| 49 | 24 | 21 | Modest pre-five-color challenge near random p90 |
| 50 | 27 | 29 | Two-move relief for the first five-color boss |
| 51 | 44 | 28 | Remove excessive slack while retaining sensitivity headroom |
| 60 | 38 | 32 | Six-move trim above sensitivity-random p90 |
| 61 | 48 | 25 | Remove the second large unused-move discontinuity |
| 70 | 39 | 35 | Four-move trim above sensitivity-random p90 |

Controls are Levels 1, 2, 3, 34, 48, and 62. They cover tutorials, untuned neighbors,
and a later five-color board. Objectives, cell maps, seed functions, spawn weights,
mechanics, score formulas and boss durations are unchanged in every trial.

Run the development server on an unused local port:

```bash
npm run dev -- --host 127.0.0.1 --port 4175 --strictPort
```

Candidate: `http://127.0.0.1:4175/?gwTestMode=1&gwBalanceProfile=pilot-moves-v1&level=51`

Control: `http://127.0.0.1:4175/?gwTestMode=1&gwBalanceProfile=canonical-control-v1&level=51`

Change only `level` to review another pilot/control. Both named profiles isolate
all campaign save load/persist/reset operations in memory and suppress score
submission, even with an authenticated session. Reloading starts a fresh preview
save. The active profile is captured at application load: deleting the query
mid-run cannot release either fence. Normal saves are neither loaded nor changed.

Activation requires development mode, one exact `gwTestMode=1`, and one known
profile name. Missing, duplicate, unknown, or nonexact selectors use canonical
behavior. A stale `from` budget fails closed to that level's authored budget.
Production builds ignore candidate requests; the profile selectors and candidate
IDs are absent from the generated production bundle. No production balance menu,
alternate framework, backend endpoint, or dependency was added.

### Acceptance Protocol

The current implementation has **no human pilot sessions or content acceptance**.
For each pilot, alternate which profile is tried first across levels and record
order/replay count: retries reuse the same board seed, so familiarity is a bias.
Record first-attempt win/loss, moves unused, boss time remaining, boosters/Play On
used, actual session time, frustration points, and a short fairness judgment.
Start with no-booster/no-Play-On attempts to match the screening cohorts; record
assisted runs separately. The QA Win button verifies isolation only and is never
a playtest win. Compare controls before drawing a campaign-wide conclusion.

Manual goals: 35/50 should feel less abruptly restrictive; 51/61 should stop feeling
like near-unlimited retries; 19/49/60/70 should gain modest tension without unclear
failure causes. The shorter move budgets need not reduce actual winning session
time, since winning paths often terminate earlier already. Nominal presentation
estimates are not a replacement for a stopwatch or player feedback.

### Production Migration Boundary

Canonical content migration is not authorized by this preview. `worker/validation.ts`
uses `worker/level-limits.json` both for unassisted maximum moves and recomputed
stars. All eight accepted budget changes would therefore require a separately
reviewed validator-limit update. Specifically, 35 at 19 moves and 50 at 28-29 moves
exceed today's server maxima; reductions can produce different star counts even
when move counts remain below the old maximum (for example, Level 51 at 15 moves
is two stars out of 28 but three stars out of 44). Do not regenerate limits, change
validation/scoring, submit synthetic runs, or deploy canonical candidates here.

### Candidate Report Reproduction

`candidate-analysis.json` compares 500 seeds/policy/cohort for the eight pilots and
100 for the six unchanged controls. Each control's complete cohort metrics must
equal its committed baseline row. The report records human sessions as an empty
list and acceptance as false until real results exist. It pins the adapter, App,
loader, candidate data, and baseline sources. To reproduce, use a fresh output
path or temporarily move an existing report aside; the write is exclusive.

Run the 500-seed command above, then use its printed full report path:

```bash
OUTLIERS=/absolute/path/from/the/500-seed/command/report.json
node --experimental-transform-types --input-type=module - "$OUTLIERS" <<'NODE'
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const { analyzeCampaign, sourceHashes } = await import('./scripts/analyze-balance.mjs');
const { selectBalanceProfile, applyBalanceProfile } = await import('./src/dev/balancePreview.ts');
const spec = read('docs/balance/candidates/pilot-moves-v1.json');
const baseline = read('docs/balance/baseline.json');
assert.equal(sha('docs/balance/baseline.json'), spec.baselineSha256);
assert.equal(sha(process.argv[2]), spec.outlierSha256);
const outliers = read(process.argv[2]), before = sourceHashes();
assert.deepEqual(before, baseline.sources);
const extra = Object.fromEntries(['src/App.tsx', 'src/data/levels.ts', 'src/dev/balancePreview.ts',
  'docs/balance/candidates/pilot-moves-v1.json'].map(path => [path, sha(path)]));
const profile = selectBalanceProfile({ isDevelopment: true, search: '?gwTestMode=1&gwBalanceProfile=pilot-moves-v1' });
const load = id => applyBalanceProfile(read(`public/levels/level_${String(id).padStart(3, '0')}.json`), profile);
const analyze = (ids, samples) => analyzeCampaign(ids.map(load), {
  seeds: Array.from({ length: samples }, (_, i) => i + 1),
  onLevel: (level, totals) => console.log(`Candidate level ${level.id}: ${totals.runs} runs, ${totals.actions} actions`)
});
const candidatePilots = analyze(spec.changes.map(change => change.levelId), 500);
const controls = analyze(spec.controls, 100);
for (const control of controls.levels) {
  const row = baseline.levels.find(level => level.id === control.id);
  assert.ok(row, `Baseline is missing control level ${control.id}`);
  assert.deepEqual(control.cohorts, row.cohorts);
}
assert.deepEqual(sourceHashes(), before);
for (const [path, hash] of Object.entries(extra)) assert.equal(sha(path), hash);
const report = { schemaVersion: 1, profile: spec, baselineOutliers: outliers,
  candidatePilots, controls, sources: { ...before, ...extra },
  acceptance: { humanSessions: [], contentAccepted: false, canonicalLevelsChanged: false } };
writeFileSync('docs/balance/candidate-analysis.json', JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
NODE
```

### Historical First Candidate Results

The following first-trial numbers use the superseded one-direction action space.
The pilot budgets remain fixed hypotheses, not newly selected from these numbers.
Use the corrected directed-swap report below for current comparisons.

The comparison completed 27,600 new runs / 394,868 actions with zero errors or
rejections in 306.58 seconds: 24,000 pilot runs and 3,600 control runs. All six
controls exactly match their baseline cohort metrics. The 125 source hashes still
match. Report SHA-256:
`a28ab5dbc1e7e12f8615a1e4d9255b524240549452b43c6f038c17e0633c0570`.

| Level | Production random before -> trial | Sensitivity random before -> trial | Trial sensitivity Wilson 95% | Production median unused | Nominal mean session seconds, random / visible / objective |
|---|---|---|---|---:|---|
| 19 | 96.2 -> 91.0% | 98.8 -> 95.2% | 93.0-96.8% | 4 | 87 / 53 / 56 |
| 35 | 70.6 -> 78.6% | 75.8 -> 83.8% | 80.3-86.8% | 3 | 108 / 92 / 90 |
| 49 | 99.0 -> 92.2% | 96.6 -> 89.6% | 86.6-92.0% | 5.5 | 108 / 79 / 92 |
| 50 | 68.6 -> 77.8% | 72.4 -> 81.8% | 78.2-84.9% | 4 | 151 / 114 / 133 |
| 51 | 100 -> 100% | 100 -> 99.0% | 97.7-99.6% | 13 | 94 / 74 / 80 |
| 60 | 99.8 -> 98.2% | 100 -> 96.4% | 94.4-97.7% | 11 | 133 / 107 / 104 |
| 61 | 100 -> 99.2% | 100 -> 95.2% | 93.0-96.8% | 9 | 102 / 84 / 78 |
| 70 | 99.8 -> 97.6% | 97.6 -> 92.6% | 90.0-94.6% | 11 | 148 / 125 / 101 |

The session column sums mean move count x 3.25 seconds, mean nominal forced
presentation, and win fraction x 2.5-second ending. It is a counterfactual raw-move
completion estimate, not a measured human duration or a prediction of when the
boss clock would stop a losing player. Boss clock models remain separate in the
report. Objective-aware trial wins remain 100% for all production pilot seeds;
visible trial wins range 96.4-100%. Bot-policy skill bias remains substantial.

Level 51 still triggers the >=95% random-win, >40% unused-move, and neighboring
unused-move-jump flags. This first trial does not solve its difficulty curve.
Do not tighten it again solely to hit a bot target; review the concrete current
and candidate boards with a person before choosing another iteration.

Verification so far: seven new pure adapter tests pass; all 352 unit tests and all
100 level validations pass. Fourteen focused Chromium/iPhone WebKit instances pass
unchanged after the five predicted integration reds (unapplied budget, two save
leaks, two attempted score submissions). Requests were intercepted before network
access. Development selectors are absent from production bundle `index--KEa5xel.js`.
No Worker, canonical level, engine, auth, normal-save implementation or score
formula changed. High audit gate passes with the two pre-existing moderate Vitest
advisories reported separately.

Six local capture flows at 1280x720, explicit 393x852 WebKit, and 320x740 pass all
60 stage-identity comparisons, with zero page errors/overflow and every row center
reachable. Inspected desktop/mobile/narrow screenshots show readable profile
labels, intact boards and reachable trays. Evidence:
`/var/folders/34/jr0n1ps531348kntshnbv8rm0000gn/T/gridwatch-balance-preview-review-GYRLUr/`.
An additional six-flow capture at the actual preset's 393x659 viewport passed at
`/var/folders/34/jr0n1ps531348kntshnbv8rm0000gn/T/gridwatch-balance-preview-review-rygCGo/`.
These are automated browser checks, not physical devices, human playtests, or
acceptance. The full regression stopped at 156 passed / 1 failed / 29 not run:
mobile `presentation.spec.ts:562` timed out on `page.goto` with a blank screenshot,
before the rocket/TNT action. Evidence is retained at
`/private/tmp/gridwatch-task12-first-failure-20260909/`. The full gate is not green;
navigation diagnostics are separate and do not erase this failure.

The traced unchanged-build full reproduction also failed before gameplay:
163 passed / 1 failed / 22 not run, with a blank `about:blank` page in a different
mobile combo case. A 300-navigation minimal diagnostic passed. The installed
Playwright 1.62.1 / WebKit 2336 has a related upstream navigation issue.
The reporter's [follow-up process samples](https://github.com/microsoft/playwright/issues/42385#issuecomment-5539073362)
attribute their reproduction to display-sleep/window-animation thread accumulation.
A [maintainer response](https://github.com/microsoft/playwright/issues/42385#issuecomment-5545275294)
and [reporter verification](https://github.com/microsoft/playwright/issues/42385#issuecomment-5545690086)
report a fix in newer WebKit. These are upstream observations, not proof of this
app's local root cause. This host's power logs show display sleep during the long
runs, but the exact local deadlock was not sampled; it remains a working hypothesis.

The successful full gate keeps the display awake temporarily, without test retries,
timeout increases, assertion changes, global preferences or dependency upgrades:

```bash
caffeinate -diu npm run test:e2e -- --trace=retain-on-failure --max-failures=1
```

The assertion ends with the command. Preserve first-failure artifacts in a fresh
private directory before another diagnostic run. The evidence parent is
`/private/tmp/gridwatch-task12-awake-gate-dLiTUG/`: 186/186 passed in 13.8 minutes,
including both formerly stalled cases, zero retries. This validates the temporary
environment workaround on the unchanged build, not a fix to WebKit or proof of
the precise local deadlock. All 125 candidate source hashes match. Task 12's
automated gates are green; human pilots and content acceptance are still open.

## Corrected Directed-Swap Rescreen

PR 48 review identified an omitted player choice: the engine enumerates adjacent
swap pairs once, but reversing a drag can change the newly created power-up's
anchor. The analyzer now evaluates both directions for every policy and counts
directed initial choices, without duplicating taps or changing engine behavior.
The Level 1 production-seed regression verifies different rocket endpoints, not
just different action labels. The pilot budgets above remain fixed hypotheses.

The corrected all-level baseline and its full repeat each completed 60,000 runs /
774,513 actions with zero errors or rejected actions. Their JSON is byte-identical,
including all 121 pinned source hashes. Baseline SHA-256:
`9bd3a7646f0afe4118b806075e8238d39aa5e96fd938962d9a45513edf2a4418`.

| Cohort | Random wins / 10,000 | Visible-match wins / 10,000 | Objective-aware wins / 10,000 |
|---|---:|---:|---:|
| Production | 9,848 | 9,993 | 9,999 |
| Sensitivity | 9,835 | 9,985 | 9,996 |

Ninety-one post-tutorial levels trigger the >=95% production-random win flag;
74 have median unused moves above 40%. Seven neighboring unused-move jumps and
two win-rate jumps remain. These are corrected bot diagnostics, not player win
rates or human acceptance of the candidate.

The corrected 500-seed outlier screen completed 24,000 runs / 356,346 actions.
Outlier SHA-256:
`7d857ec90039a77f765f3080eeae875245c3406344d66151766741f9b740057e`.
The fixed-budget candidate completed 24,000 runs / 356,705 actions; the six controls
completed 3,600 runs / 38,277 actions and exactly match baseline cohort metrics.
All runs have zero errors/rejections. All 125 candidate source hashes match.
Candidate report SHA-256:
`095d969a4f9b55fe1642096a32901cb80f37b84e6e77361f9b36efd5910d3433`.
The full outlier data is embedded in the checked-in candidate report.

| Level | Production random before -> trial | Sensitivity random before -> trial | Trial sensitivity Wilson 95% | Trial production median unused |
|---|---|---|---|---:|
| 19 | 96.0 -> 90.0% | 98.0 -> 93.0% | 90.4-94.9% | 4 |
| 35 | 71.8 -> 79.4% | 74.4 -> 80.2% | 76.5-83.5% | 3 |
| 49 | 98.4 -> 93.2% | 97.4 -> 90.4% | 87.5-92.7% | 5 |
| 50 | 66.2 -> 81.2% | 72.0 -> 84.6% | 81.2-87.5% | 4 |
| 51 | 100 -> 100% | 100 -> 99.0% | 97.7-99.6% | 13 |
| 60 | 100 -> 98.2% | 99.2 -> 93.4% | 90.9-95.3% | 11 |
| 61 | 100 -> 99.4% | 100 -> 96.2% | 94.1-97.6% | 9 |
| 70 | 99.8 -> 99.2% | 98.6 -> 94.4% | 92.0-96.1% | 11 |

Each rate uses 500 seeds for the named cohort/policy. Production visible-match
trial wins range 96.4-100%; objective-aware wins range 99.8-100%. Level 51 still
triggers high-win, unused-move, and neighboring-jump flags. The corrected analysis
does not establish a balanced campaign or authorize canonical budget changes.

Verification after the review repairs: 354/354 units, 100 level validations,
build/typechecks, high audit, and 188/188 browser tests pass with zero browser
retries. Final bundle `index-D-BYXmzJ.js` matches the browser-tested build. The
reset-storage failure regression first failed on Chromium and WebKit, then passed
with a visible alert, unchanged displayed save, no unhandled rejection, and a
successful retry. Desktop/mobile screenshots confirm the error remains readable.
No engine, canonical level, backend, dependency, or browser configuration changed.
Human pilot sessions and content acceptance remain open.
