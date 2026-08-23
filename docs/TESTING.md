# Testing and visual QA

The suite is split so deterministic simulation bugs fail quickly and browser/GPU defects
still produce reviewable evidence.

## Commands

- `npm run typecheck` — strict TypeScript across the site, worker, game, and tests.
- `npm run test:unit` — deterministic unit and property tests.
- `npm run test:coverage` — coverage report with enforced thresholds.
- `npm test` — unit tests, production build, and rendered-worker HTML contract.
- `npm run test:e2e` — browser boot, WebGL pixel, streaming, movement, gathering,
  persistence, interaction, map waypoint guidance, proportional citizen streaming,
  resource budgets, and context-loss tests.
- `npm run test:visual` — captures deterministic entry/world screenshots as Playwright artifacts.
- `npm run test:visual:update` — writes or reviews golden snapshots when
  `VISUAL_BASELINES=1` is set in a pinned browser environment.
- `npm run test:ci` — complete CI gate.

Install the Playwright browser once in a new environment with
`npx playwright install --with-deps chromium`. Keep browser version, OS image, viewport,
DPR, locale, timezone, seed, and quality profile pinned before accepting golden images.

## Deterministic browser mode

`?test=1` enables a narrow `window.__STILLPOINT_TEST__` bridge. It fixes the world seed,
keeps the framebuffer readable for nonblank-pixel inspection, bypasses pointer-lock for
automation, and exposes snapshot, teleport, fixed views, deterministic target descriptors,
discrete interactions, discovery, waypoint commands, fixed headings, and WebGL context-loss
operations. Normal gameplay does not depend on the bridge.

Macro-world tests enforce the 9,216 km² area, biome coverage, settlement hierarchy,
economic metadata, bounds, road connectivity, and river continuity. Gathering tests prove
that partial work persists, final hits grant loot exactly once, and removed objects cannot
duplicate inventory. Locomotion property tests constrain stamina and landing math.

Navigation tests cover north-zero clockwise bearings, yaw sign, 359°/000° wraparound,
five-degree compass windows, arbitrary map/world coordinate round trips, non-square map
clicks, target validation, player/quest target replacement, stale clears, one-shot arrival,
auto-clearing scripted targets, manual-waypoint save migration, and render-frame store
notifications. Browser coverage sets and replaces a pin through actual map coordinates,
checks the HUD guide and compass marker, and restores the manual waypoint after reload.

Citizen property tests sample random atlas chunks and enforce deterministic IDs, provenance,
road/settlement route bounds, hierarchy-scaled density, quality caps, finite time sampling,
empty wilderness, and the absence of interaction fields. Browser coverage teleports between
Vesper Crown, Dustmere, and wilderness; it verifies population ratios, stable reload IDs,
non-interactivity, and a dedicated megacity crowd screenshot candidate.
The WebGL-free citizen-engine regression test also proves that sub-tick presentation changes
instance transforms, preventing a return to visibly throttled crowd motion.

Each Playwright test retains traces, failure screenshots, and video on failure. Visual
tests attach full-page candidate screenshots even when golden comparison is not enabled.
Use a reviewed golden-update job; never update baselines automatically on every CI run.

Absolute GPU timing should run on a pinned RTX 3060/3070 self-hosted lane after shader
warmup. Ordinary headless CI should gate deterministic state, draw-call/triangle/chunk
budgets, resource plateaus, and screenshot stability rather than treating software-renderer
FPS as representative hardware performance.
