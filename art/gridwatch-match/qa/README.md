# QA probes for the dark-realism work

Small Playwright scripts used to check a build by eye and by number. They launch the installed
Chrome and resolve `@playwright/test` from this repo. `<repo>` is the repository root.

| Script | What it does |
| --- | --- |
| `board-shots.mjs <repo> <base url> <out prefix> [level] [extra query]` | Board idle, a held tile, and after the swap (0,0)→(1,0), at desktop and iPhone 15 sizes; prints canvas size, moves, errors |
| `page-shots.mjs <repo> <url> <out prefix> [full]` | Page screenshots at both sizes; prints errors and horizontal overflow |
| `screen-shots.mjs <repo> <base url> <out prefix> [extra query]` | Walks the menus by their own buttons: home, operations, levels, intel, account, store, settings, at both sizes; prints errors and horizontal overflow per screen |
| `game-shots.mjs <repo> <base url> <out prefix> [level] [extra query]` | The game screen, the dock scrolled into view, and the result dialog after test mode's QA Win, at both sizes |
| `hold-shot.mjs <repo> <base url> <out prefix> <level> <row> <col>` | Presses one tile, screenshots the held state, lets go without a move, screenshots again |
| `acceptance-probe.mjs <repo> <base url> <out prefix>` | Checks the e2e suite does not make: refused sprites fall back, ten level entries, hide and show mid-level, the full menu-to-resume loop, a grayscale board, a recorded swap |
| `perf-probe.mjs <repo> <base url> [level] [runs]` | Classic against dark on one build: time to board ready, image bytes, frame intervals at rest and through a swap, JS heap; desktop and phone sizes, each also with the CPU slowed four times |
| `dev-probe.mjs <repo> <base url> <out prefix>` | Home and level 7 load, the DEV badge, errors, any non-GET request |
| `menu-click.mjs <repo> <base url>` | The main menu's two buttons go where they should |
| `net-check.mjs <repo> <base url>` | Which piece images each theme downloads |
| `find-404.mjs <repo> <url>` | Lists failed requests |
| `alpha_stats.py <rgba png>` | Whether a plate's transparency is real, with a coarse coverage map |
| `release-check.mjs <repo> <base url> <out dir>` | A production build as a player meets it, desktop and phone: the theme it opens in, console errors, failed requests, the audio fetched. `GW_STEPS` names buttons to press. For before and after a production deploy |
| `autoplay-probe.mjs <repo> <base url>` | When the music starts under Chrome's real autoplay rule: a direct visit, an arrival by a link from a page of the same site (the Nexus menu), and a first tap on a phone-sized touch screen |
| `csp-server.mjs <dist dir> <port>` | Serves a build under `/play/match/` with the live page's security policy, for `release-check.mjs` |
| `pw.config.mjs` | Runs the repo's e2e suite on a build whose default is the archived classic board (`GW_THEME=classic`) |

Since 2026-10-10 the dark board is every build's default, so `npm run test:e2e` is the suite on
the dark board. The same suite on the archived classic board, which stays a working fallback
(WebKit for the mobile project, as the repo defines it):

```sh
GW_REPO="$PWD" GW_OUT=/tmp/gw-e2e-classic GW_THEME=classic GW_BUNDLED=1 \
  npx playwright test --config art/gridwatch-match/qa/pw.config.mjs
```

To probe a real build without uploading it: `npm run cf:dev-instance -- --dry-run`, then
`npx wrangler dev --config wrangler.dev.jsonc --port 8798 --ip 127.0.0.1` serves `dist/`.

Each run takes about 16 minutes and builds from the working tree when it starts; do not
run a Blender build at the same time (both are CPU-bound and the timing tests are sensitive).
Useful URLs: `?gwTestMode=1&level=N` jumps to a level; `?theme=classic` / `?theme=dark`;
`?hidpi=0`. Level 54 has zero-day tiles; level 34 has locked, encrypted and malware cells; level 100 has
every board power-up but the propeller and every cell state, generators included.
