# QA probes for the dark-realism work

Small Playwright scripts used to check a build by eye and by number. They launch the installed
Chrome and resolve `@playwright/test` from this repo. `<repo>` is the repository root.

| Script | What it does |
| --- | --- |
| `board-shots.mjs <repo> <base url> <out prefix> [level] [extra query]` | Board idle, a held tile, and after the swap (0,0)→(1,0), at desktop and iPhone 15 sizes; prints canvas size, moves, errors |
| `page-shots.mjs <repo> <url> <out prefix> [full]` | Page screenshots at both sizes; prints errors and horizontal overflow |
| `screen-shots.mjs <repo> <base url> <out prefix> [extra query]` | Walks the menus by their own buttons: home, operations, levels, intel, account, store, settings, at both sizes; prints errors and horizontal overflow per screen |
| `dev-probe.mjs <repo> <base url> <out prefix>` | Home and level 7 load, the DEV badge, errors, any non-GET request |
| `menu-click.mjs <repo> <base url>` | The main menu's two buttons go where they should |
| `net-check.mjs <repo> <base url>` | Which piece images each theme downloads |
| `find-404.mjs <repo> <url>` | Lists failed requests |
| `alpha_stats.py <rgba png>` | Whether a plate's transparency is real, with a coarse coverage map |
| `pw.config.mjs` | Runs the repo's e2e suite with the dark board as the build default |

The e2e suite on the dark board (WebKit for the mobile project, as the repo defines it):

```sh
GW_REPO="$PWD" GW_OUT=/tmp/gw-e2e-dark GW_THEME=darkRealism GW_BUNDLED=1 \
  npx playwright test --config art/gridwatch-match/qa/pw.config.mjs
```

`npm run test:e2e` is the same suite on the classic board. Each takes about 16 minutes; do not
run a Blender build at the same time (both are CPU-bound and the timing tests are sensitive).
Useful URLs: `?gwTestMode=1&level=N` jumps to a level; `?theme=classic` / `?theme=dark`;
`?hidpi=0`. Level 54 has zero-day tiles; level 34 has locked, encrypted and malware cells; level 100 has
every board power-up but the propeller and every cell state, generators included.
