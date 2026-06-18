# GridWatch Match Web

Browser port of GridWatch Match, a cyberpunk match-3 puzzle game by WarSignalLabs.

Play now: https://GridWatchMatchWeb.warsignallabs.net

Built for the Community Dev Challenge: "Make a game we can play."

## What You Made

GridWatch Match Web is a playable browser version of GridWatch Match. Players clear cybersecurity-themed match-3 objectives across hand-authored levels, using rockets, propellers, TNT, light balls, boosters, and move extensions to defend the grid.

## How Codex Helped

Codex helped port the iOS game plan into a static web app, scaffold the React/Phaser/Vite project, sync assets and level data, implement the TypeScript board engine and Phaser board renderer, and debug playability issues across desktop and mobile viewports.

## How To Play

- Select and drag a tile into an adjacent tile to swap.
- Match 3 or more tiles to clear them and advance objectives.
- Match 4 or more tiles to create power-ups.
- Swap or activate power-ups for larger clears and combos.
- Finish the listed objectives before moves or boss timers run out.
- Use boosters from the in-game tray when available.

Controls:

- Mouse: click, hold, and drag a tile toward an adjacent tile.
- Touch: press and drag a tile toward an adjacent tile.
- Keyboard: menus and buttons follow normal browser focus behavior.

## Stack

- React 19 + TypeScript + Vite 8
- Phaser 4 board renderer
- Pure TypeScript board engine
- Static Cloudflare Pages deployment

## Local Setup

```sh
npm ci
npm run sync:assets
npm run validate:levels
npm run dev
```

The sync script expects the sibling iOS repository at:

`../GridWatchMatch`

If your local checkout uses a different layout, run sync with `GRIDWATCH_IOS_SOURCE=/path/to/GridWatchMatch/GridWatchMatch/GridWatchMatch npm run sync:assets`.

## Web Asset Overrides

`npm run sync:assets` copies the current iOS art into `public/assets/images`, but it preserves `public/assets/images/web-overrides`.

To replace web art without modifying the iOS source, save PNGs under `public/assets/images/web-overrides/<same-relative-path>`, then run `npm run sync:assets` so the generated manifest points at the override when it exists. For example, replacing `public/assets/images/tiles/tile_packet.png` uses:

`public/assets/images/web-overrides/tiles/tile_packet.png`

Art direction and exact override filenames are in `docs/art/cyberpunk-asset-spec.md`. Agents must not commit generated binary art.

## Scripts

```sh
npm run dev
npm run build
npm run preview
npm run sync:assets
npm run validate:levels
npm run test
npm run test:e2e
```

## Deployment

Hosted on [Cloudflare Pages](https://pages.cloudflare.com/) at
`https://GridWatchMatchWeb.warsignallabs.net` (served from the subdomain root).

Cloudflare's Git integration auto-builds on push to `main`:

- **Build command:** `npm run build`
- **Build output directory:** `dist`
- **Node version:** pinned via `.nvmrc`

The GitHub Actions `CI` workflow (`.github/workflows/ci.yml`) runs
validate/test/audit/build on PRs and `main` for quality signal but does **not**
deploy — Cloudflare owns deployment.

## Monetization

The web store is a playable stub. It shows the current coin packs and Security Clearance Pass surfaces, but real purchase fulfillment is disabled until a secure backend is added.
