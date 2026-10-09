# GridWatch Match — dark-realism art upgrade

Working record for the brief `README-Claude-Code-GridWatch-Match-Blender-v1.md` (Google Drive,
`GridWatchArt / 4 - GridWatch Match`). Local branch `dev/dark-realism`; local commits only, played
on the dev instance (`npm run cf:dev-instance`). Nothing here changes rules, saves, accounts or the
production build's default look.

Status, 2026-10-09: **all five tiles, the socket and the held state are in the game** on the dark
board. Power-ups, the remaining cell states, the board frame and the UI are still to build (§6).

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
| power-up `rocket` horizontal / vertical | rockets | `powerup_rocket_h` / `_v` | to build (one source, two renders) |
| power-up `tnt` | charge | `powerup_tnt` | to build |
| power-up `propeller` | drone | `powerup_propeller` | to build |
| power-up `lightBall` | orb | `powerup_light_ball` | to build |
| cell, movable | drawn rounded rectangle | `cell_base` | **built, in game** |
| cell, tile held for a drag | (none) | `cell_selected` | **built, in game** |
| cell, design-locked (`debugDesignLocked`) | drawn amber clamps and padlock | `cell_locked` | to build |
| cell, blocked (`!isMovable`) | drawn dark rectangle | `cell_blocked` | to build |
| overlay `encryptedVolume` (hp) | drawn cyan film + number | `cell_overlay_encrypted` | to build |
| underlay `malwarePropagation` (hp) | drawn red film + number | `cell_overlay_malware` | to build |
| generator `honeypot` | drawn "H" | `cell_generator` | to build |
| board surround | drawn rounded rectangle | `board_frame` | to build |

The game has no tap-to-select: a tile is pressed and dragged. `cell_selected` therefore shows on
the cell whose tile is being held, which is the only selection state that exists.

## 3. Conventions

- One Blender unit is one board cell. +Y is up the board, +Z toward the viewer, a piece sits on
  z = 0 and is centred on the origin. Sprite pivot is the frame centre.
- **Pieces:** orthographic camera pitched 14° off vertical, 1.10 units across the frame, so the
  near edge shows thickness. **Cells:** orthographic, straight down, exactly 1.0 unit, opaque, so
  they abut into one grid. Same lights and colour management for both.
- **Light:** key from the upper left, cool fill, low rim, a dim soft world for the metal to
  reflect. No contact shadow is baked; the game draws its own.
- **Colour:** Standard view transform, sRGB. AgX was tried first and turned the emissive cyan
  pastel; Standard keeps the small identity lights saturated.
- **Materials** are procedural and shared (`gwm_*`): blackened steel, graphite ceramic, brushed
  titanium, socket steel, well floor, gold contact, smoked glass, and one emitter per identity
  colour. The grit is layered: chipping on convex edges (an inside-AO edge mask times noise, its
  reach kept under the thinnest part's thickness), sparse pitting and directional scuffs, grime in
  recesses (an ordinary AO mask times noise), and mottling. Never one uniform scratch layer.
- **Alpha:** pieces are straight alpha on a transparent film; cells are opaque.
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
final build of all eight current assets takes about twenty minutes. It writes the `.blend` sources
(`art/gridwatch-match/blender/`), the masters, the shipping sprites
(`public/assets/images/match-v2/`) and `src/data/matchV2Manifest.generated.json`, which is what the
game loads and what `src/tests/boardTheme.test.ts` checks against the files on disk.

## 5. Integration

- `src/game/boardTheme.ts` is the one selection point: `classic` (default) or `darkRealism`.
  `VITE_BOARD_THEME=darkRealism` makes it a build's default (only the dev instance sets it);
  `?theme=classic` or `?theme=dark` overrides on any build. **Rollback is that parameter.**
- `BoardScene` loads the manifest's sprites only in the dark theme and falls back to the classic
  picture wherever a sprite is missing or failed to load.
- **Device pixels.** The classic canvas is the CSS size, so a phone draws each cell about 46 px
  wide and stretches it three times. The dark theme sizes the canvas in device pixels (capped at
  3×) and zooms it back (`GameCanvas.tsx`); `?hidpi=0` turns that off for comparison. The scene
  reads only its own scale, so layout and input follow; drawn line widths are still in canvas
  pixels and so are thinner at 3× (to review with the remaining state overlays).

## 6. Plan

1. ~~Inspect, map IDs, set conventions, build the pipeline.~~
2. ~~Vertical slice: `tile_route`, socket, held state, a real swap, at phone size.~~
3. ~~Russ's look at the slice~~: "make it darker and grittier, then build the other three tiles".
4. ~~Remaining tiles: `threat`, `defense`, `data`, `zeroDay`; darker and grittier (Russ, 10-09).~~
5. Five power-ups, then the booster-tray versions of them.
6. Cell states and overlays, the board frame, the runtime shadow under the new pieces.
7. UI treatment in React/CSS (HUD, objective, dock, menus, results) and the Tish menu art.
8. Full loop check, measured performance against the classic baseline, then the acceptance list.

## 7. Open

- **Tish:** no rigged model exists in this repo. The menu needs a clean, text-free art plate; the
  V2 menu image has baked UI and cannot be used as a background.
- **Measured performance** (cold load, frame time, memory against the classic board) is not done.

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
