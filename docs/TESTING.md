# Testing and visual QA

The suite is split so deterministic simulation bugs fail quickly and browser/GPU defects
still produce reviewable evidence.

## Commands

- `npm run typecheck` — strict TypeScript across the site, worker, game, and tests.
- `npm run test:unit` — deterministic unit and property tests.
- `npm run test:coverage` — coverage report with enforced thresholds.
- `npm test` — unit tests, production build, and rendered-worker HTML contract.
- `npm run test:e2e` — browser boot, WebGL pixel, split world/citizen streaming, movement,
  gathering, persistence, interaction, representative world-collision probes, map waypoint guidance, temporary fast travel,
  day/night controls, proportional citizens, resource budgets, and context-loss tests.
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
discrete interactions, discovery, waypoint and fast-travel commands, deterministic world-time
controls, fixed headings, wildlife diagnostics, and WebGL context-loss operations. The
essentials hooks additionally expose manual save/load, audio diagnostics, FOV and look
sensitivity, invert Y, conflict-safe key rebinding, quality selection, direct health/fall
impact/recovery controls, current-location discovery, and stable inspectable IDs. Snapshots
include overlays, rebound prompts, settings, inventory weight/count, health and exposure,
condition tags, save status, audio diagnostics, and current/discovered locations. Normal
gameplay does not depend on the bridge, and environmental audio is intentionally disabled in
test mode so Web Audio permissions cannot make deterministic automation flaky.

The bridge also exposes the render-only Canopy Load Lab, forest load selection, full graphics
diagnostics, and benchmark capture state. Browser coverage uses the developer UI to travel to
the lab and change load, verifies the analytic lake and fixed 81-chunk residency, proves
increasing visual density does not increase targets or colliders, and confirms lab travel is
excluded from the normal player save. Unit tests enforce deterministic load prefixes, lake and path
exclusions, monotonic instance budgets, terrain continuity, percentile/headroom math, delayed
GPU sample joining and coverage, immutable report context, foreground-hitch retention,
unsupported-timer fallback, invalid-result safety, and disjoint-query cleanup. CI never asserts
an absolute FPS, GPU time, or extension availability.

Macro-world tests enforce the 9,216 km² area, biome coverage, settlement hierarchy,
economic metadata, bounds, road connectivity, and river continuity. Gathering tests prove
that partial work persists, final hits grant loot exactly once, and removed objects cannot
duplicate inventory. Item metadata supplies deterministic total count and carried weight for
the inventory overlay and encumbrance rule.

Settings tests clamp corrupt numeric preferences, reject invalid enums and key codes, keep
every gameplay action bound exactly once, swap conflicts, and verify compact HUD labels.
`PreferencesStore` tests round-trip view, sound, quality, horizon, world detail, and binding preferences;
they also cover invalid versions, absent storage, and storage permission failures. Save-store
tests migrate versions one through six into the version-seven envelope, round-trip player
pose/condition and location discovery alongside prior world state, sanitize every new field,
report slot availability, and recover safely from corrupt or blocked storage.

Player-condition tests lock safe and damaging fall thresholds, monotonic bounded damage,
health underflow protection, rain wetting, shelter drying, apparent-temperature response,
cold stress, stable condition tags, delayed passive recovery, and full recovery reset. The
system test confirms exposure only advances during active simulation and the rebound recover
action is routed only while incapacitated. Locomotion tests additionally cover smoothed eye
height, stamina, and landing math. The controller keeps jump buffering, coyote time, and
standing head-clearance behind explicit state seams for focused integration coverage.

Location-discovery tests enforce settlement/compound/biome priority, settlement boundary
behavior, atlas-wide biome fallback, stable known IDs, duplicate suppression, and complete
catalog copy. The system regression proves discovery checks run only during active play.

Interaction-prompt tests cover every target action and prove prompts use current rebound
interact/harvest keys rather than hard-coded UI text. Inspectable tests lock unique IDs,
complete readable records, interaction range, quality-profile behavior, and a low primitive
budget. Interaction-system coverage verifies inspectables flow through the same target
selection and action path as doors, records, pickups, and harvestables.

Environmental-audio model tests cover pause silence, weather-scaled wind and precipitation,
storm-suppressed wildlife, proportional settlement ambience, biome/shelter surface selection,
and distance-based walk/sprint/crouch cadence. The Web Audio wrapper is replaced by a seam in
system tests, which verify ambient updates, grounded distance-triggered footsteps, and cadence
reset while paused without requiring a browser audio device.

Horizon tests enforce monotonic finite profiles, the invariant 81-chunk detailed ring,
continuous concentric LOD definitions, atlas-edge clamping, deterministic settlement
silhouettes, frustum/shadow policy, no gameplay fields on proxies, and fixed budgets below
60,000 far-terrain triangles and 200 proxy instances. Browser coverage cycles and persists
all three profiles while checking that gameplay and citizen residency never changes.

Navigation tests cover north-zero clockwise bearings, yaw sign, 359°/000° wraparound,
five-degree compass windows, arbitrary map/world coordinate round trips, non-square map
clicks, target validation, player/quest target replacement, stale clears, one-shot arrival,
auto-clearing scripted targets, manual-waypoint save migration, and render-frame store
notifications. Browser coverage sets and replaces a pin through actual map coordinates,
checks the HUD guide and compass marker, and restores the manual waypoint after reload.

Atmosphere tests cover all day phases, day rollover, noon/night light ordering, seeded
random-access weather, legal weather menus for all seven biomes, impossible climate
combinations, continuous epoch transitions, temperature response, and corrupt-clock recovery.
Fast-travel tests prove every authored key location is indexed, IDs and arrivals are stable,
arrival points avoid rendered water and colliders, and atlas-edge fallbacks remain bounded.

Collision tests cover high-speed tunneling, exact tangents, wall sliding, thin walls,
axis-aligned and rotated buildings, rounded corner hits and near misses, perpendicular-wall
seams, invalid-spawn depenetration, collider-order independence, repeated corner pressure,
malformed input, and randomized high-speed crossings. Spatial-index property tests compare
indexed results with brute force. World-streaming tests then verify one unique collider per
rendered building, tree, rock, ruin, and landmark; exact render-matrix geometry; road
clearance; opening accessibility; and immediate collider removal after harvesting.

Citizen property tests sample random atlas chunks and enforce deterministic IDs, provenance,
road/settlement route bounds, hierarchy-scaled density, quality caps, finite time sampling,
empty wilderness, and the absence of interaction fields. Browser coverage teleports between
Vesper Crown, Dustmere, and wilderness; it verifies population ratios, stable reload IDs,
non-interactivity, and a dedicated megacity crowd screenshot candidate.
The WebGL-free citizen-engine regression test also proves that sub-tick presentation changes
instance transforms, preventing a return to visibly throttled crowd motion.

Vegetation tests enforce all seven biome profiles, twelve native woody species, unique
ground-cover families, low-poly geometry limits, decorative non-interactivity, and exact
tree target/collider parity. Wildlife tests sample the atlas for deterministic sparse habitat
selection, legal species, empty-chunk prevalence, per-chunk and resident caps, finite analytic
poses, sub-tick smoothness, quality thinning, stable return IDs, frustum bounds, and idempotent
GPU cleanup. The browser boot contract also confirms that wildlife never appears in the
interaction target registry.

Field-equipment tests lock the phone light to a default-off state, one-press `L` routing,
camera-world alignment, two fixed beams, the 48 m range, performance/cinematic/Ultra shadow policy,
compile prewarming, and idempotent cleanup. Browser coverage exercises both the accessible HUD
toggle and keyboard path at night while exposing deterministic diagnostics through the test bridge.

Each Playwright test retains traces, failure screenshots, and video on failure. Visual
tests attach full-page candidate screenshots even when golden comparison is not enabled.
Use a reviewed golden-update job; never update baselines automatically on every CI run.

Absolute GPU timing should run on a pinned RTX 3060/3070 self-hosted lane after shader
warmup. Use Developer Tools → Performance Lab, travel to grid `64:-60`, choose a forest
stop and refresh target, then run the 10-second capture. Use the fixed arrival viewpoint and
stand still for directly comparable runs. Copy Report emits the run timestamp, world seed,
hardware/browser, quality, horizon/world-detail, framebuffer, weather/time, load counts,
GPU-query coverage, engine/delivery classifications, percentiles, 1% low, and headroom as JSON.
Ordinary headless CI
should gate deterministic state, draw-call/triangle/chunk
budgets, resource plateaus, and screenshot stability rather than treating software-renderer
FPS as representative hardware performance.

The 9×9 full-detail world ring must remain 81 chunks while citizen and wildlife rings remain 25.
Standard, Extended, and Unlimited only replace bounded HLOD geometry. Five world-detail
stops independently refine the render-only near ring and scenery within explicit triangle
and instance caps while resident gameplay counts remain fixed. Browser tests lock
that separation so a future draw-distance change cannot inflate interaction or citizen
work, and the resource plateau test cycles horizon modes during relocation to catch leaks.
Horizon unit coverage also caps deterministic city-light points at 320/eight draws, verifies
their bloom layer, and exercises day/night plus session-toggle visibility. Rendering-policy tests
lock the weather/time grade inputs while the developer graphics-module flow resets every
post-processing, reflection, skyline, shadow, detail, wind, cloud-shade, wet-pooling, and
storm-lightning switch to its default-on state. Player-sandbox unit coverage locks 1×/3×/8×
movement, normalized pitch-aware flight, vertical controls, collision/gravity bypass, and shared
state reset. The functional browser flow additionally proves invincibility blocks a fatal fall,
active cheats remain visible after closing the console, and disabling developer mode lands safely.
