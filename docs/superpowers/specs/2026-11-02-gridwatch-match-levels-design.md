# GridWatch Match: 200 Challenging Levels

Date: 2026-11-02. Status: for Russ's approval. Nothing here is built yet.

## Why

Russ played the game and the levels feel the same. Royal Match and Candy Crush get hard by filling the board with things that block you, and by making clearing those things part of winning. GridWatch Match does neither. A random-move bot wins about 98% of attempts across levels 1-100, and blockers never count toward winning.

Those games also have hundreds of levels. This one stopped at 100 only because its levels were copied from the iOS game. From 2026-11-02 the web game stands alone.

## What Russ decided

- The web game gets its own level set. iOS has no say in any decision.
- Late levels should be challenging.
- The game is not limited to 100 levels.
- Levels 101-200 bring back the same ten villains, tougher.
- Team members stop being villains. DREAD, VYRUS, SHARD, Lotus and Malus take over sectors 5, 7, 8, 9 and 10, each with a new portrait that matches the existing five. DREAD replaces AX-10M².
- Panes really block, the malware goal is "Remove all malware", and the leaderboard stays (see Rule changes).
- Clearing blockers becomes part of winning a level (Russ's suggestion, which this design adopts).

## Goals

1. Win conditions that ask the player to clear blockers.
2. A measured difficulty rise, from easy first levels to levels that fail about half the time on a first try.
3. 200 levels, built so adding more later is cheap.
4. Campaign length set in one place, so going past 200 is a data change.

## Not in this project

- Villains beyond the ten in this document, and new music.
- True gaps in the board, walls between cells and non-square boards. These need engine and phone layout work, so they get their own design later.
- Lives, energy or anything that stops a player from retrying.
- Real-money coin packs.
- Any change to the iOS repo.

## What would make this a failure, even if it worked

- Levels that feel unfair: lost to luck, with no sense of what to do differently.
- A hard level whose goal the player cannot understand from the picture and the words on screen.
- Levels that all feel the same at a higher number, which is the complaint this project exists to fix.
- Early levels that stop being a gentle start.

## How the game changes

### Blocker goals

| Blocker | Picture (`public/assets/images/match-v2/cells/`) | Today | Goal |
|---|---|---|---|
| Encrypted pane | `cell_encrypted.png` | 1 to 3 layers, sits over a piece, blocks nothing | New: "Clear N encrypted panes". One counts when its last layer breaks. See Rule changes. |
| Malware | `cell_malware.png` | 1 to 2 layers, sits under a piece, spreads, blocks nothing | New: "Remove all malware". See Rule changes. |
| Locked cell | `cell_lock.png` | Piece cannot move or fall until cleared | New: "Free N locked cells". |
| Honeypot | `cell_generator.png` | Fixed, cannot be destroyed, drops pieces below | Never a goal. It stays an obstacle. |

Honeypots cannot be a goal because nothing in the engine can destroy them. Power-ups skip them.

Each blocker goal must behave like a collect goal does now:
- The goal chip shows the blocker's picture and a count.
- Cleared blockers fly to the chip, like collected pieces.
- The count holds back until they land.

The first level that uses each blocker goal shows a short card with the blocker's picture and how to clear it. The player can dismiss it, and it shows once per save.

Implementation note: goals in the engine are judged when a piece clears. Pane and lock goals have to count when the blocker itself breaks, whether or not a piece was there. The engine stays pure (`src/engine` has no display code).

### Campaign of 200

`src/data/areas.ts` becomes the source of campaign length. Sectors 11-20 hold levels 101-200, ten levels each, with villains in the same order as sectors 1-10.

Sector names, subtitles and rewards are the designer's draft, and Russ can change any of them:

| Sector | Levels | Name | Subtitle | Villain | Clear reward |
|---|---|---|---|---|---|
| 11 | 101-110 | Perimeter Defense II | VEXIS returns | VEXIS | 1,100 |
| 12 | 111-120 | Threat Intelligence II | KRON returns | KRON | 1,200 |
| 13 | 121-130 | Incident Response II | ZERO returns | ZERO | 1,300 |
| 14 | 131-140 | SOC Operations II | AX-10M returns | AX-10M | 1,400 |
| 15 | 141-150 | Zero-Day Defense II | DREAD returns | DREAD | 1,500 |
| 16 | 151-160 | AI Counterattack II | AURORA-6 returns | AURORA-6 | 1,600 |
| 17 | 161-170 | Firmware Purge II | VYRUS returns | VYRUS | 1,700 |
| 18 | 171-180 | Protocol Override II | SHARD returns | SHARD | 1,800 |
| 19 | 181-190 | Deep Net Sweep II | LOTUS returns | LOTUS | 1,900 |
| 20 | 191-200 | Final Breach II | MALUS returns | MALUS | 2,000 |

Every tenth level stays a boss level, with the timer and boss music. Level names come from a written list, so names stay unique and hand-editable. Levels 1-100 keep their current names.

### Villains

| Sector | Today | From now on | Portrait colour | Sector colour change |
|---|---|---|---|---|
| 5 Zero-Day Defense | AX-10M² | DREAD | Acid green | None |
| 7 Firmware Purge | RUSTY | VYRUS | Ember orange | None |
| 8 Protocol Override | TEE | SHARD | Electric violet | None |
| 9 Deep Net Sweep | TISH | LOTUS | Cold teal | None |
| 10 Final Breach | HELIX | MALUS | Hot magenta | None |

Rusty, Tee, Tish and Helix stay as playable team members in `src/data/heroes.ts`, with their current pictures. Tish stays on the menu and as the voice.

Russ makes the portraits in ChatGPT from `docs/art/2026-11-02-villain-portrait-prompts.md`. They arrive square, with no text in the image. Nothing ships with a new villain name over an old team photo, so the campaign goes out only when all five are in.

The five dossiers in `src/data/intel.ts` for AX-10M², RUSTY, TEE, TISH and HELIX are replaced, keeping their unlock levels (41, 61, 71, 81, 91) and using the `THREAT` faction. The threat report about AX-10M2 building a counter-profile moves to DREAD. Today's dossiers do not support the new text: the files record only that Malus is the primary antagonist, that Lotus hacks for Malus, and that DREAD, SHARD and VYRUS are Malus's allies. The rest of this text is the designer's draft for Russ to rewrite.

| Villain | Classification | Background | Threat assessment | Classified |
|---|---|---|---|---|
| DREAD | THREAT LEVEL: CRITICAL - ZERO-DAY HUNTER | DREAD answers to Malus. No GRIDWATCH sensor has recorded a face. | Never let it set the pace. Clear the board before it closes in. | Every recorded sighting ends where the last one began. |
| VYRUS | THREAT LEVEL: SEVERE - FIRMWARE CORRUPTION | VYRUS answers to Malus. Whatever it touches stops obeying its own code. | Corruption spreads while you wait. Burn it out early. | Recovered systems still show the infection after a full wipe. |
| SHARD | THREAT LEVEL: SEVERE - PROTOCOL BREAKER | SHARD answers to Malus. It breaks through hardened systems by force. | Do not meet it head on. Open the board from the edges. | Its armour has been damaged twice. It has been seen undamaged since. |
| LOTUS | THREAT LEVEL: CRITICAL - DEEP NET HACKER | LOTUS is the hacker behind Malus's operations. Every breach in the deep net carries the same signature. | Sweep the whole board. A single missed node gives LOTUS a way back. | A lotus mark was found inside a GRIDWATCH system nobody had breached. |
| MALUS | THREAT LEVEL: EXISTENTIAL - PRIMARY ANTAGONIST | MALUS is behind every threat in these files. All of them answer to MALUS. | Everything before this was part of the plan. Understand the grid, not just the pattern. | Core log: 'The grid will fall. It has to.' |

### Which levels change

- **Levels 1-10 stay exactly as they are.** They teach the game, and most browser tests use level 1.
- **Levels 11-100 are rebuilt.** Their number and name stay; their board, goals and move limit change.
- **Levels 101-200 are new.**

### How hard

Difficulty is the share of first attempts that fail. It is measured with no bought power-ups and no Play On.

| Levels | First-try fail rate |
|---|---|
| 1-10 | Under 5%, unchanged |
| 11-30 | 5 to 15% |
| 31-50 | 15 to 30% |
| 51-100 | 30 to 50% |
| 101-200 | 45 to 60% |

Russ said "challenging". These numbers are the designer's reading of that, and Russ can move them.

Within each sector, difficulty rises and falls so no stretch is a wall: the ninth level and the boss are hardest, and the first level after a boss gives some relief. No more than three levels in a row sit at the top of their band. This is the designer's call.

Fail rates only mean something if the test bot resembles a person. See Calibration.

### Variety

Each sector recipe names a main blocker and a board pattern, so sectors feel different. Patterns are arrangements such as a full lower half of panes, a ring, diagonals, or columns of locks. Lines of honeypots can already divide a board into separate regions without engine work, because falling pieces already stop at fixed cells. That gives some of the "grid separation" Russ saw in the Royal Match videos. Later sectors combine blockers, and the second tour uses denser patterns than the first.

A move limit never jumps between sectors the way it does now, where it goes from 17-29 in sectors 1-5 to 34-48 from level 51.

### Stars and coins

Stars are based on the share of moves left: half or more for three, a fifth or more for two. On hard levels, that would make nearly every win one star. The tool reports star spread for each level, and star thresholds move into the level file so hard levels can still award three stars. The rule for a level is that the bot's best quarter of wins earns three stars. This is the designer's call.

Existing coin rules stay: stars and leftover moves pay on the first win only. Harder levels leave fewer moves, so wins pay less, and sectors 11-20 pay more for clearing. Power-up prices stay until the tool reports what a whole campaign earns. Then Russ decides whether they need changing.

Play On matters more on hard levels. Today, pressing Play On with under 500 coins ends the mission. It will instead show that the player is short of coins and leave the mission open, so they can choose to give up. This is the designer's call.

### Saved games

Stars, scores and coins stay attached to level numbers. A player who has passed level 60 keeps that progress and is not sent back. Someone who finished level 100 sees level 101 next.

## How levels get made

### Test bot

A new bot plays by trying each legal move, scoring the board that results, and taking the best one. Scoring favours goal progress, then power-ups, then board position. It replaces the random bot for measurement. It plays with the real seed from `levelSeed()`, which gives every attempt at a level the same starting board, and it breaks ties at random so attempts differ.

The engine has no way to copy a game in progress today, so the bot needs one, kept pure. The game's behaviour must not change.

Boss levels are the exception. The bot has no sense of a clock, so it measures their moves only. The timer is a backstop, not a second way to lose: it is set at 4 seconds per move, with a minimum of 60 seconds. Today's level 100 allows about 2.6 seconds per move, and running out is an instant loss with no Play On, which suits the "lost to luck" failure this design avoids. This is the designer's call.

### Level tool

A script under `scripts/levels/` reads sector recipes, builds candidate levels from a fixed seed, plays each with the bot, and keeps only those inside the target band. It adjusts moves and goal counts to get there. Output is the normal `public/levels/level_NNN.json`, so the game does not change how it loads levels. Generated files are committed and can be hand-edited, and a hand-edited level is marked so the tool won't overwrite it.

The tool writes a report for each level:
- fail rate
- star spread
- average leftover moves
- coin earnings

`npm run validate:levels` gains checks that fail a level with no legal way to reach its goal, such as a pane goal larger than the panes on the board.

At the current speed of about 13 ms per random game, trying every move at every turn makes a game some 30 times slower, so 200 games per candidate could mean hours for a full run. Overnight is acceptable. Sharing work across processor cores and reusing results for unchanged recipes are left to the builder. 200 games gives a fail rate to within about 7 points, which is good enough for bands 15 points wide.

### Calibration

Russ plays about 12 levels sampled across the bands on first sight, including at least three boss levels, on a phone, and reports win or lose with moves left. That sets how skilled the bot needs to be, or how far to shift its bands. One person is a small sample, so this is a correction, not proof. Earlier data suggests Russ beats a random bot only modestly: 17 and 19 moves left on levels 6 and 7 of 29, against 15 and 11.

## What else must change

- **Fixed 100s.** `src/App.tsx` (lines 356, 527, 548, 555, 610, 1406, 1408), `src/components/DarkHomeScreen.tsx` (30, 59, 65), `src/state/progress.ts` (133) and `worker/validation.ts` (38) all read from the campaign length. Test mode (`App.tsx:356`) must accept new levels, or browser tests cannot reach them.
- **Live score server.** It rejects any level above 100 as "Unknown level" and checks moves against `worker/level-limits.json`. New limits come from `npm run generate:level-limits`, and the Worker must go live with the levels. It also recalculates stars from moves used, so per-level star thresholds must reach it too, or wins on rebuilt levels are rejected.
- **Leaderboard.** Match's board is shared with Nexus (`gridwatch-match / campaign / r1`), and the campaign total is the sum of the best score on each level. Rebuilding levels 11-100 changes what those scores mean, and Russ chose to keep the board anyway. See Rule changes.
- **iOS copy step.** `scripts/sync-ios-assets.mjs` deletes and replaces level files. Its level step is removed, so it can never overwrite the web levels. Art and audio copying can stay until Russ wants it gone.
- **Tests.** `src/tests/resolution.test.ts` replays a recorded set of 2,000 runs against `public/levels`, and those recordings need their own frozen copies of the levels they used, under `src/tests/fixtures/resolution/`. The pane and malware rule changes also mean re-recording those runs with `docs/research/2026-09-08-game-feel/freeze-resolution.mjs`, because frozen levels protect against level changes, not rule changes. Browser tests that open levels 34 and 100 need checking against rebuilt levels. Tests on levels 1, 5, 6, 7 and 10 are safe: those levels have no panes or malware.
- **Villain pictures.** `src/data/areas.ts` and `src/data/intel.ts` move to the five new villains. The pictures are added as web-owned art, because `assetManifest.generated.ts` is generated by the iOS copy step, which would otherwise undo them. `AX10M2.png` and the villain copies of the team photos are removed from `public/assets/images/villains/`. The hero copies stay.
- **Sector screen.** Twenty sector cards are a longer scroll. A heading separates the first ten from the returning ten. This is a menu, so scrolling is fine there.

## Order of work

1. Ship the feel work on `dev/feel-pieces-effects`, once Russ has checked it on his phone and said to. This work then starts on a new `dev/...` branch from `main`.
2. Foundation: campaign length, sectors 11-20, frozen test levels, iOS step removed, new villains and dossiers. The game plays as before, with the extra sectors locked. Portraits go in as Russ delivers them.
3. Pane and malware rule changes, blocker goals, flights, goal chips and intro cards, tested on a few hand-made levels. The 2,000 recorded runs are re-recorded here.
4. Bot, plus a baseline report on today's 100 levels.
5. Level tool and recipes. Rebuild 11-100 and build 101-200.
6. Russ's calibration on the dev site, then retune.
7. All five portraits in. Full browser suites on dark and classic, phone check by Russ, then push on Russ's word.

Each step ends on the dev site. Nothing is pushed until Russ says so, and merging and production stay with Russ.

## Rule changes Russ approved

### Panes really block

A pane freezes the piece under it, so it cannot swap, match or fall, like the crates in Royal Match. Each match next to it, or power-up hit, removes one layer, and one move removes at most one layer per pane. This replaces today's pane, where the piece stays free and one swap can strip all three layers.

### "Remove all malware"

The malware goal is to remove every malware cell, and the goal chip shows how many are left, so that count can rise. Malware spreads by one cell only after a move that removes none, like chocolate in Candy Crush. Leaving it costs the player, and the goal cannot become impossible. This replaces today's spreading on every cascade step, which got easier when left alone.

### The campaign leaderboard stays

Match's board, shared with Nexus, is not reset when the levels ship. No Nexus work is needed, and the registry already allows level numbers up to 999. Old scores on easy boards stand against new scores on hard ones. It can still be reset later.

## Left to the builder

- How the bot scores a board, as long as it is calibrated.
- How the engine copies a game in progress.
- Recipe file format, and how candidates are searched.
- Exact intro card design, within the dark theme and the existing modal style.
