# Campaign Balance Screening

This is an offline diagnostic, not a player model, automatic level generator, or
authorization to change production content. Canonical levels, engine outcomes,
score formulas, Worker validation, and player saves are unchanged.

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

- `random`: uniform choice among engine-reported legal swaps and power-up taps.
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

The nine focused unit regressions exercise the exact CLI loader and exports:
independent deterministic choices, first-terminal stop, authored move limit,
invalid input, fail-loud engine errors, Wilson intervals, repeatable cohort output,
and separate boss controllable/forced time. The frozen all-level engine corpus
remains the engine-outcome regression gate.

## September 9 Baseline

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
