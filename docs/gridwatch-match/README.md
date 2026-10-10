# GridWatch Match — dark-realism art upgrade

Working record for the brief `README-Claude-Code-GridWatch-Match-Blender-v1.md` (Google Drive,
`GridWatchArt / 4 - GridWatch Match`). Branch `dev/dark-realism`, built as local commits and played
on the dev instance (`npm run cf:dev-instance`); Russ approved the look on 2026-10-09 and asked for
the push to be prepared (`HANDOFF.md` has the readiness check). Nothing here changes rules, saves,
accounts or the production build's default look.

**2026-10-10: the dark theme is the game's look.** Russ: "Dark theme becomes production. Old theme
is to be archived. When select Match from the Nexus menu, dark theme should come up immediately."
Every build now opens in the dark theme. Classic is archived as a hidden fallback (his choice of
the three ways to archive it): its art and code stay in place, players are never shown it, and
`?theme=classic` still brings it up. Where this file says classic is the default, read it as the
history of the switch; §5 has the current rule.

**The same day: the menu opens on a title screen.** Russ: "The music needs to start at page load",
then, told a browser will not play a note before the page is touched: "Music guaranteed on the
first screen using 'one tap' is fine. Sort of like we did for Drift." So the dark menu opens with
"tap to enter" ("press any key" for a mouse and keyboard) standing in the panel where its actions
will be; the first click anywhere or the first key opens the menu and starts the music
(`src/state/titleGate.ts`, `DarkHomeScreen`). It shows once per page load, not when the music is
off, and not in test mode. The archived classic menu has none.

Status, 2026-10-09: **everything in the brief's inventory is in the game** in the dark theme: five
tiles, five power-ups (board and equipment dock), every cell state the engine has, the board
frame, the game HUD and dock, the main menu, and the shared treatment on the other screens. What
is not done is listed in §7.

## 1. What the game is (inspected, not assumed)

- **Renderer:** Phaser 4 owns one 2D WebGL canvas for the board (`src/game/BoardScene.ts`); React
  owns every menu, the HUD and the booster tray (`src/App.tsx`, `src/styles.css`). There is no 3D
  renderer, so per the brief the assets are **modelled in Blender and delivered as transparent
  sprites**. No new engine is introduced.
- **Board size** comes from level JSON (`public/levels/`, `snapshot.grid.rows/cols`); nothing in
  the art or the integration assumes 7×7. Cell size is `floor(min(canvas) / max(rows, cols))`.
- **Engine** (`src/engine`) is a pure deterministic state machine. The art work does not touch it.
- **Pieces** load through `src/data/assetManifest.generated.ts` (iOS art, with web overrides under
  `public/assets/images/web-overrides/`). A piece is drawn at `0.85 × cell`.
- **Persistence:** campaign, settings and inventory are saved to IndexedDB (localStorage fallback)
  and, signed in, to cloud saves through `@gridwatch/account-kit`; scores go through `/api/score`.
  A theme swaps pictures only and stores nothing.
- **Tools:** Blender 5.1.0 (`/Applications/Blender.app`), Cycles on the CPU. An earlier unmerged
  study (`codex/blender-piece-pipeline`, `tools/art/`) is not used; it told us that Cycles CPU
  renders reproduce exactly here and that PNG metadata has to be stripped for stable bytes.

## 2. Runtime ID → visual asset

Runtime IDs are the game's (`src/engine/types.ts`) and are never renamed.

| Runtime ID | Today's picture | Visual asset | State |
| --- | --- | --- | --- |
| tile `packet` | cyan double chevron | `tile_route` | **built, in game** |
| tile `threat` | red triangle | `tile_threat` | **built, in game** |
| tile `firewall` | orange shield | `tile_defense` | **built, in game** |
| tile `key` | gold contact card | `tile_data` | **built, in game** |
| tile `zeroDay` | split violet crystal | `tile_zeroday` | **built, in game** (Russ's fifth-tile reference, 2026-10-09) |
| power-up `rocket` horizontal / vertical | rockets | `powerup_rocket_h` / `_v` | **built, in game** (one source, lit twice) |
| power-up `tnt` | charge | `powerup_tnt` | **built, in game** |
| power-up `propeller` | drone | `powerup_propeller` | **built, in game** |
| power-up `lightBall` | orb | `powerup_light_ball` | **built, in game** |
| booster tray (`rocket`, `rocketVertical`, `tnt`, `propeller`, `lightBall`) | booster icons | the power-up sprites above | **in game** |
| cell, movable | drawn rounded rectangle | `cell_base` | **built, in game** |
| cell, tile held for a drag | (none) | `cell_selected` | **built, in game** |
| cell, design-locked (`debugDesignLocked`) | drawn amber clamps and padlock | `cell_lock` (clamps over the tile, on `cell_base`) | **built, in game** |
| cell, blocked (`!isMovable`, no locked tile) | drawn dark rectangle | `cell_blocked` | **built, in game** (no shipped level starts with one) |
| overlay `encryptedVolume` (hp) | drawn cyan film + number | `cell_encrypted` (pane over the tile) + live number | **built, in game** |
| underlay `malwarePropagation` (hp) | drawn red film + number | `cell_malware` (the socket itself) + live number | **built, in game** |
| generator `honeypot` | drawn "H" | `cell_generator` | **built, in game** |
| board surround | drawn rounded rectangle | `board_frame` (cut into corners and one-cell lengths) | **built, in game** |

The game has no tap-to-select: a tile is pressed and dragged. `cell_selected` therefore shows on
the cell whose tile is being held, which is the only selection state that exists.

## 3. Conventions

- One Blender unit is one board cell. +Y is up the board, +Z toward the viewer, a piece sits on
  z = 0 and is centred on the origin. Sprite pivot is the frame centre.
- **Pieces:** orthographic camera pitched 14° off vertical, 1.10 units across the frame, so the
  near edge shows thickness. **Cells:** orthographic, straight down, exactly 1.0 unit, opaque, so
  they abut into one grid. **Overlays** (the lock clamps, the encrypted pane, the board frame):
  the cell camera, transparent between their parts, so they register on the grid over whatever
  is under them. Same lights and colour management for all three.
- **Light:** key from the upper left, cool fill, low rim, a dim soft world for the metal to
  reflect. No contact shadow is baked; the game draws its own.
- **Colour:** Standard view transform, sRGB. AgX was tried first and turned the emissive cyan
  pastel; Standard keeps the small identity lights saturated.
- **Materials** are procedural and shared (`gwm_*`): blackened steel, graphite ceramic, brushed
  titanium, socket steel, well floor, gold contact, smoked glass, and one emitter per identity
  colour. The grit is layered: chipping on convex edges (an inside-AO edge mask times noise, its
  reach kept under the thinnest part's thickness), sparse pitting and directional scuffs, grime in
  recesses (an ordinary AO mask times noise), and mottling. Never one uniform scratch layer.
- **Alpha:** pieces and overlays are straight alpha on a transparent film; cells are opaque.
- **Thin parts:** anything thinner than about 0.04 units sits wholly inside the edge-wear mask and
  renders as bare metal. Thin trim uses `gwm_gunmetal` (little wear) or is made thicker.
- **Sizes:** 1024 px masters in `art/gridwatch-match/previews/`, 256 px shipping sprites (a piece
  is at most about 140 device pixels wide on today's screens).
- **Reproducible:** Cycles CPU, fixed seed 923101, no denoiser, metadata stripped.

## 4. Build

From the repository root (validated with Blender 5.1.0 on macOS):

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
  --python-exit-code 1 --python art/gridwatch-match/scripts/build.py -- --asset all
```

`--asset <id>` builds one; `--quality draft` writes only `previews/draft/` for a quick look. A
final build of all twelve current assets takes about half an hour. It writes the `.blend` sources
(`art/gridwatch-match/blender/`), the masters, the shipping sprites
(`public/assets/images/match-v2/`) and `src/data/matchV2Manifest.generated.json`, which is what the
game loads and what `src/tests/boardTheme.test.ts` checks against the files on disk.

## 5. Integration

- `src/game/boardTheme.ts` is the one selection point: `darkRealism` (every build's default since
  2026-10-10) or the archived `classic`. `?theme=classic` or `?theme=dark` overrides on any
  build, and a build made with `VITE_BOARD_THEME=classic` starts on classic. **Rollback is that
  parameter or that build setting.** `index.html` carries the theme attribute, so the page is dark
  from its first paint; `src/main.tsx` is what turns it off for classic.
- `BoardScene` loads the manifest's sprites only in the dark theme, and then does not download
  the classic picture each one replaces. If a dark sprite fails to load, the classic picture is
  loaded in its place, and every use checks which texture exists.
- Power-ups are drawn in a dozen effects (combo charge, rocket flight, drone strike…). Those all
  read one map, `powerUpTextures`, which a scene points at the dark sprites once they have loaded.
- Round parts (rocket bodies, canisters, the light ball) are lathed or spherical meshes with their
  chamfers in the profile; a piece's camera aims at its own mid-height and frames it to fill the
  sprite (`center_z`, `ortho_scale` in `gwm/assets.py`).
- **UI.** `main.tsx` puts the active theme on `<html data-board-theme>`; every dark UI rule lives
  in `src/darkRealism.css`, scoped to that attribute or to `dr-*` classes only the dark theme
  renders. The dark main menu is its own component (`src/components/DarkHomeScreen.tsx`) with the
  classic screen's data, actions, labels and test id, so the same e2e test covers both.
- **Menu art.** The city and Tish are two text-free plates Russ supplied (ChatGPT), converted by
  `art/gridwatch-match/scripts/export_menu_plates.sh` to `public/assets/images/match-v2/menu/`.
  They are plates, not Blender models: **no rigged Tish exists.** All words and numbers on the
  menu are live; nothing is taken from the concept's baked text.
- **Cell states.** `renderCell` picks one rendered cell per position (plain well, malware well,
  generator, blocked cover) and then lays the overlays that register on it: the encrypted pane
  over the tile, the lock clamps over that. A locked cell is a plain well plus the clamps, so no
  state is baked into a tile. Remaining strength (`hp`) is a live number on a small plate whose
  size comes from the cell. The held treatment swaps a socket's texture and puts back whatever
  that socket was showing. Every one of these falls back to the classic drawing if its sprite is
  missing.
- **Board frame.** `board_frame` is the surround modelled round a one-cell opening, 0.1875 cell
  wide. `BoardScene.syncBoardFrame` cuts the sprite into four corners and four one-cell lengths
  (`matchV2FrameSlices`) and lays them round whatever `rows × cols` the level has; each length is
  its own beam with a joint at both ends, so the cuts fall on real seams. The frame lives in its
  own container and is rebuilt only when the board's place or size changes. `boardTileSize` sizes
  the cells so the frame is always inside the canvas (the classic board's sizing is the same
  function with a 12 px margin and no frame).
- **Shadow.** Dark pieces sit down in a well, so in place of the classic's hard ellipse below a
  piece they get one soft shared shadow texture, offset away from the key light.
- **Game screen and the other screens.** Same markup as classic; `darkRealism.css` restyles the
  HUD (a grid: back, level, moves, breach timer when there is one, score, rules), the objective,
  the equipment dock (five bays, count in the corner), the result dialog, the top bar, sector and
  level cards and the settings switches (still the same checkboxes). On a phone the navigation is
  a tab bar fixed to the foot of the screen, with icons drawn as CSS masks; on the game screen it
  stays the compact row under the brand, because the board and dock need the height. The global
  dark `button` rule is wrapped in `:where()` so it never outranks a classed button.
- **Device pixels.** The classic canvas is the CSS size, so a phone draws each cell about 46 px
  wide and stretches it three times. The dark theme sizes the canvas in device pixels (capped at
  3×) and zooms it back (`GameCanvas.tsx`); `?hidpi=0` turns that off for comparison. The scene
  reads only its own scale, so layout and input follow. The dark board's own chrome is now sprites
  or sized from the cell; the effects (`vfx.ts`) still draw their lines in canvas pixels, so on
  a 3× canvas those lines are a third as wide as on classic (§7).

## 6. Plan

1. ~~Inspect, map IDs, set conventions, build the pipeline.~~
2. ~~Vertical slice: `tile_route`, socket, held state, a real swap, at phone size.~~
3. ~~Russ's look at the slice~~: "make it darker and grittier, then build the other three tiles".
4. ~~Remaining tiles: `threat`, `defense`, `data`, `zeroDay`; darker and grittier (Russ, 10-09).~~
5. ~~Five power-ups, and the booster tray showing them~~ (2026-10-09).
6. ~~Cell states and overlays, the board frame, the runtime shadow under the new pieces~~
   (2026-10-09).
7. ~~The Tish main menu; HUD, objective, equipment dock; campaign and level screens, results,
   settings; the phone's tab bar~~ (2026-10-09).
8. Full loop check, measured performance against the classic baseline, then the acceptance list
   (§10).

## 7. Open

Not done, or done only in part. None of it blocks playing the dev build.

- **No physical phone.** Everything was checked in the installed Chrome and in Playwright's WebKit
  at iPhone 15 size. Touch feel, a real phone's frame rate with a 3× canvas, and a dim screen in
  daylight are unverified. `?hidpi=0` is the switch if a phone struggles with the larger canvas.
- **Tish is two plates, not a model.** No rigged Tish exists; that stays separate work.
- **Results view.** The result dialog has the shared treatment and its real score and stars, but
  the stars are still the sentence "3 star(s)", not the concept's three gold stars, and there is
  no rewards breakdown beyond what the game already shows. No mission-briefing screen was added:
  the game goes straight from the level tile to the board, and the brief says not to add a step.
- **`cell_blocked` has not been seen in play.** No shipped level starts with a blocked cell, so it
  is verified as a render and a mapping test only.
- **Effects are the classic effects.** Match bursts, rocket trails, the TNT blast and the rest
  keep their shapes, colours and timing. On a 3× canvas their drawn lines are a third as wide.
- **Intel, Account, Store, Rules** carry the shared treatment through common classes. They were
  checked for layout at both sizes, not designed screen by screen against a concept.
- **Heap after repeated level entry** climbs about 0.16 MB per entry over thirty entries, by the
  same amount in classic and dark (§10). It predates this work and was not chased.

## 8. Evidence for the slice (2026-10-09, commit `36b0c45`)

- `npm run test`: 529/529. `npm run validate:levels`: 100 passed.
- The repo's e2e suite, 218/218, twice: once as production builds it (classic board) and once
  built with `VITE_BOARD_THEME=darkRealism` (dark board, device-pixel canvas). Both runs used the
  installed Chrome for the desktop and the iPhone 15 projects, because Playwright's bundled
  browsers for this version are not downloaded on this Mac; **the mobile project normally runs
  WebKit, and that was not run.**
- On the dev instance, at 1280×800 and iPhone 15 size, in both themes: the level-1 swap
  (0,0)→(1,0) resolves to 24/25 moves and 3/20 packets, no console error, no failed request.
- Screenshots: `evidence/2026-10-09-slice/` (dark and classic at phone size, the held cell).
- Not measured: cold load, frame time and memory against the classic board; a real phone.

## 9. Evidence for the five tiles and the menu (2026-10-09)

- Five tiles, commit `b5d56b0`: `npm run test` 529/529; `npm run test:e2e` 218/218 as the repo
  defines it (bundled Chromium, and WebKit for the iPhone 15 project), and 218/218 again built
  with `VITE_BOARD_THEME=darkRealism`.
- Main menu: unit tests 529/529; `app.spec.ts` and `carry-over.spec.ts` (the home screen and both
  of its buttons) 60/60 in each theme, WebKit included. The full suite was not re-run for the
  menu commit.
- Screenshots: `evidence/2026-10-09-five-tiles/`, `evidence/2026-10-09-menu/`.

## 10. Evidence for the cell states, frame and UI (2026-10-09, commit `6745e82`)

- `npm run test`: 533/533. `npm run validate:levels`: 100 passed. `tsc --noEmit`: clean.
- e2e for the menu and power-up commits (`1def334`, `6d678e5`): 218/218 classic and 218/218 dark,
  bundled Chromium and WebKit.
- e2e for `6745e82`: **218/218 classic, 218/218 dark** (same projects, 15.7 and 15.8 minutes).
  Committed after that run and not re-run through e2e: one CSS declaration (the dark primary
  button's corner radius), this record and the QA probes.
- `art/gridwatch-match/qa/acceptance-probe.mjs` on a local build of the dev instance, dark board,
  iPhone 15 size (`evidence/2026-10-09-acceptance/acceptance-local-build.jsonl`):
  - every dark sprite refused (18 requests): the board loads on the classic pictures, the level-1
    swap takes a move, no page error. With only the frame, the lock clamps and one tile refused,
    the rest stay dark and those three fall back (`level34-three-sprites-refused.png`);
  - a level entered and left ten times: one canvas while playing, none on the menu, no page error;
  - page hidden for 1.5 s mid-level and shown again: the next swap takes a move;
  - menu → Quick Deploy → a swap → win → Next Level → fail → Retry → back → home → reload: the
    campaign reads 0 / 100, then 1 / 100 before and after the reload; level 1 shows ★★★ and level
    2 Ready; Resume Operations opens Operations.
- Shapes with colour removed: `level100-phone-grayscale.png`. Same viewport before and after:
  `level34-phone-before-classic.png`, `level34-phone-after-dark.png`. One swap and its cascade,
  recorded: `level1-phone-swap.webm`. Screens: `evidence/2026-10-09-cells-ui/`.

- **Live dev site, `60cefc0-dev`** (2026-10-09): home and a level load at both sizes with the
  badge, no console error, no failed request and no request other than GET; the dark board
  downloads 22 `match-v2` pictures and none of the classic ones it replaces, `?theme=classic` the
  reverse (0 and 15); the acceptance probe gives the same results as on the local build; no menu
  screen overflows sideways at either size. (Vite's own dev server logs a 404 that no built
  instance does: check console errors on a build, not on `vite`.)

### Measured against classic

`art/gridwatch-match/qa/perf-probe.mjs`, level 1, both themes from one local build, installed
Chrome on this Mac (12 cores); "phone" is iPhone 15 emulation at device pixel ratio 3. Raw lines:
`evidence/2026-10-09-acceptance/perf-local-build.jsonl`.

| | Classic | Dark |
| --- | --- | --- |
| Board pictures on disk | 10 files, 2,439 KB | 18 files, 1,278 KB |
| Those as GPU textures (RGBA) | 10.0 MB (512 px each) | 4.7 MB (256 px; frame 352 px) |
| Image bytes for a level, to 4 s after ready | 3,371 KB (5,823 KB with the CPU slowed) | 2,747 KB |
| Board ready after navigation, CPU ×1 (3 runs) | 171–345 ms | 166–170 ms |
| Board ready, CPU slowed ×4 | 636–701 ms | 595–609 ms |
| Canvas, desktop / phone | 528² / 327² px | 1056² / 981² px |
| Frame interval at rest, median / p95 | 16.7 / 16.8 ms | 16.7 / 16.8 ms |
| Frame interval through a swap and cascade | 16.7 / 16.8 ms, at most one 33 ms frame | the same |
| JS heap after play | 20–26 MB | 19–20 MB |
| JS heap, entry 1 → 30 of a level | 16.4 → 21.3 MB | 15.6 → 21.0 MB |

What this does and does not show: the dark board is lighter to download and holds less texture
memory, and on this Mac both themes sit on the 60 Hz frame cap at every size, with the CPU slowed
four times as well. Load times are over loopback, so they compare the two themes and say nothing
about a network. The dark canvas has four times the pixels on the desktop and nine times on the
phone; a slowed CPU does not model a phone's GPU, so **a real phone's frame rate is unmeasured.**

### Acceptance list (brief §8)

Visual: tiles and power-ups follow V2 ✔ (by eye against the references); distinguishable at
gameplay size and in grayscale ✔; tile and background separate ✔ on these screens, **dim phone
unverified**; one shadow per piece, no neon halos ✔; held, locked, blocked, normal distinct ✔
(blocked from its render only); Tish: plates, limitation reported ✔; UI live, no baked values ✔;
board size and cell size from the game ✔.

Functional: swaps, invalid swaps, matches, cascades, input locking ✔ (e2e, both themes); rocket
orientation ✔ (one model lit twice, mapped by engine key, e2e rocket specs); boosters and
inventory ✔ (e2e); overlays update ✔ (e2e; drawn each render from the snapshot); win, fail,
retry, next, resume, save ✔ (probe above, e2e); account, currency, progression ✔ (e2e,
untouched code; the dev site posts no score by design); missing assets fail safely ✔; no asset
errors or failed requests ✔ on the built dev instance; load, frame time, memory compared ✔ on
this Mac, **not on a phone**; background and re-entry ✔ with the heap note in §7; build, type
check and tests ✔ (the repo has no lint script).

## 11. Russ's first notes on the dev build (2026-10-09)

"It's looking good", and two things the screen did not explain:

- **"No one knows what a 'Packet' is unless you show them."** In the dark theme a collect
  objective now shows the piece it names beside its words (`App.tsx`, the objective chip; the
  text is unchanged, so the tests that read it still do). "Clear N cells" objectives name no
  piece and stay words only.
- **"What's the difference between Resume Operations and Quick Deploy?"** Resume Operations
  opens the sector list; Quick Deploy starts the next unplayed level. Each button now says so
  under its name ("Choose a sector and level", "Play Level N · sector now"); the names are
  unchanged.
- Checked: unit tests 533/533; the full e2e suite for commit `047b701`, **218/218 classic and
  218/218 dark** (bundled Chromium, WebKit for the phone project); live on `047b701-dev` with no
  console error and both menu buttons going where they say. Screens:
  `evidence/2026-10-09-first-notes/`.
- He also queued a later task (animations, sound, music): see the top entry of `HANDOFF.md`.
