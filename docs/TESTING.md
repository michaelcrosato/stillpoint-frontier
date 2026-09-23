# Testing and visual QA

The suite is split so deterministic simulation bugs fail quickly and browser/GPU defects
still produce reviewable evidence.

## Commands

Unit tests use two workers by default. This limits CPU contention in full chunk
construction tests without raising timeouts. On constrained machines, append
`-- --maxWorkers=1` to test:unit or test:coverage.

Property tests run from one fixed fast-check seed, so every run tries the same
inputs. Set `FC_SEED=<integer>` to replay the seed a failure reports or to explore
other inputs.

For a source-only release check, run typecheck, lint, test:coverage, build, then
test:rendered. The last command tests the built Worker response, not a browser.
Coverage gates apply to the explicit include list in vitest.config.ts, not the
entire repository. The list holds every unit-testable module under lib/. Engine.ts,
RenderPipeline.ts and EnvironmentMapRuntime.ts (browser-owned GPU lifecycles), the
thin system installers only Engine exercises, type-only modules and every React
component sit outside it, so the reported percentages describe the included slice
and not the codebase. The thresholds apply to the slice as a whole, and each file
must also clear a per-file floor set at the weakest file: 65% of statements and
lines, 50% of branches and functions. Browser/GPU lifecycles still need separate
acceptance.

- `npm run typecheck` — strict TypeScript across the site, worker, game, and tests.
- `npm run lint` — ESLint across source and tests.
- `npm run test:unit` — deterministic unit and property tests.
- `npm run test:coverage` — coverage report with enforced thresholds.
- `npm test` — unit tests, production build, and rendered-worker HTML contract.
- `npm run test:e2e` — browser boot, WebGL pixel, split world/citizen streaming, movement,
  gathering, persistence, interaction, representative world-collision probes, map waypoint guidance, temporary fast travel,
  day/night controls, proportional citizens, resource budgets, and context-loss tests.
- `npm run test:visual` — captures deterministic entry/world screenshots as Playwright
  artifacts. It does not compare them: without `VISUAL_BASELINES=1` each screenshot is
  only asserted to be non-blank.
- `npm run test:visual:compare` — compares against committed baselines. Sets
  `VISUAL_BASELINES=1` itself.
- `npm run test:visual:update` — rewrites the baselines. Sets `VISUAL_BASELINES=1`
  itself; run it only in a pinned browser environment.
- `npm run test:ci:static` — lint, typecheck, coverage, build, rendered contract. This
  is what the CI quality gate runs, after `npm run audit:ci`.
- `npm run test:ci` — `test:ci:static` plus the browser suites. CI runs the browser
  suites as a separate sharded job rather than through this script.
- `npm run audit:ci` — fails on any high or critical dependency advisory.

No baselines are committed, so `visual-chromium` runs in no CI job today. Generating the
first set captures whatever build produces them; review those images before committing.

Install the Playwright browser once in a new environment with
`npm run test:browser:install -- --with-deps`. Use that script rather than a bare
`npx playwright install`: every test script runs through `scripts/sites-env.sh`, which
repoints `HOME` at `.sites-runtime/home`, so Playwright resolves browsers from a
project-local cache that a bare install does not populate. Keep browser version, OS image, viewport,
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
economic metadata, bounds, road connectivity, river continuity, both landmark gateway
envelopes, and deformation-free approach roads. Gathering tests prove
that partial work persists, final hits grant loot exactly once, and removed objects cannot
duplicate inventory. Item metadata supplies deterministic total count and carried weight for
the inventory overlay and encumbrance rule.

Settings tests clamp corrupt numeric preferences, reject invalid enums and key codes, keep
every gameplay action bound exactly once, swap conflicts, and verify compact HUD labels.
`PreferencesStore` tests round-trip view, sound, quality, horizon, world detail, and binding preferences;
they also cover invalid versions, absent storage, and storage permission failures. Save-store
tests migrate versions one through seven into the version-eight envelope, round-trip player
pose/condition and location discovery alongside prior world state, sanitize every new field,
report slot availability, and recover safely from corrupt or blocked storage.

Camera-rig tests lock the exact first-person endpoint, semantic view thresholds, continuous
wheel zoom, preset cycling, isometric pitch/FOV policy, terrain, wall, and authored-overhead
retraction, focal alignment after obstruction, and damped release. Avatar tests lock its
continuous near-view fade. Input tests normalize wheel units, preserve bounded multi-event
bursts, and reject modified gestures. The camera-control system is also covered independently
so paused or inactive overlays cannot alter the saved-local view preference.

Audit regressions also cover tiny-zoom pitch continuity, presentation-owned aim
during preset transitions, key alias ownership, browser modifier handling,
dialog focus boundaries and hidden controls, full-stack gather atomicity and
Engine routing, readable saves after rejected writes, inherited loot keys, and
partial rest progress after reload. Renderer tests inject normal/fullscreen AO
and compositor failures, verify state restoration, and count capability probes.
Vegetation tests enclose every high-detail instance after quality changes.

The second audit adds real container transaction regressions (single, mixed-item,
and full-capacity transfers), invalid active-contract keys, and restored HUD button
focus during pointer lock. Camera tests raycast actual Field Unit stair/roof meshes
and preserve the open doorway; pure surface sweeps cover both vertical directions.
Compiler tests verify same-call completion and target restoration on failure.
Audio-port tests zero all four ambient beds without a subsequent simulation frame,
then restore them through normal mixing.

Performance regressions count material writes during 81-root registration and bound
registered chunk residency throughout successful far travel. Chunk tests also inject
failure before construction and verify same-center retry and fresh gameplay caches.
They do not prove exception-safe mid-factory allocation or automatic Engine recovery.
These are work-count/resource invariants, not hardware FPS assertions.
The version-42 follow-up adds a dry-canyon save round trip at −640.57 m. It
preserves both player state and camp placement and rejects invalid heights.
Engine tests keep horizon changes and Reset Settings out of the survey save
path, before and after launch. Crafting tests cover all six recipes at the
output limit and with exactly enough room. Rendered component markup tests
check disabled full-stack controls and the operations tab roles and labels.
These markup checks do not test browser focus movement.

Interaction tests count visibility queries for 20 eligible candidates. Once a
visible target has the best score, worse candidates do not run terrain or
collider checks. A blocked best candidate still permits the next visible one.
These tests measure query counts, not FPS.

Scanner tests apply the same query-count check while retaining distance/alignment
scoring, source-order ties, and the fallback after an occluded subject.
Wildlife bounds tests inspect real instance matrices at the compound, Crownspire,
and Sunscar after movement, interpolation, relocation, and quality changes. Every
instance's geometry sphere must fit inside its species' culling sphere with
frustum culling enabled. They verify geometry, not rendered pixels.

Reflection tests call the installed Three PMREM generator with a renderer test
double. They inject draw failures during cube capture and filtering, check full
renderer-state restoration, and retain a prior successful reflection when its
replacement fails. They also check that an unchanged signature does not retry.
These tests do not exercise GPU allocation failure or WebGL driver behavior.

## Dependency security checks

Run `npm audit --json` after a lockfile change and inspect complete dependency
paths, including development packages used to build the Worker. An audit exit
code of 1 means findings remain; it is not a passing security gate. Record the
scan date, severity counts, affected paths, and the reason for deferred changes.
See [DEPENDENCIES.md](DEPENDENCIES.md) for the current review. Keep dependency
changes tied to a specific finding, and rerun all source release gates after
installing the revised lockfile. Browser/GPU checks are still separate.

## Further gameplay and hardware coverage

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
silhouettes, frustum/shadow policy, no gameplay fields on proxies, and the per-detail-level
far-terrain triangle budget from `WORLD_DETAIL_PRESETS` — below 60,000 at the lowest
level, 120,000 at the default and a hard 300,000 at Maximum — alongside 200 proxy
instances. Crownspire coverage additionally locks
its sub-256-triangle camera-relative silhouette, near-range handoff, weather attenuation,
and disposal. Browser coverage cycles and persists
all three profiles while checking that gameplay and citizen residency never changes.

Navigation tests cover north-zero clockwise bearings, yaw sign, 359°/000° wraparound,
five-degree compass windows, arbitrary map/world coordinate round trips, aspect-correct
non-square map staging, zoom-anchor invariance, pan and atlas-edge clamping, target validation,
player/quest target replacement, stale clears, one-shot arrival,
auto-clearing scripted targets, manual-waypoint save migration, and render-frame store
notifications. Browser coverage zooms, pans, focuses, preserves the viewport across map closes,
sets and replaces a pin through actual map coordinates,
checks the compact HUD bearing/distance readouts and compass marker, and restores the manual
waypoint after reload.

Atmosphere tests cover all day phases, day rollover, noon/night light ordering, seeded
random-access weather, legal weather menus for all seven biomes, impossible climate
combinations, continuous epoch transitions, temperature response, and corrupt-clock recovery.
Fast-travel tests prove every authored key location is indexed, IDs and arrivals are stable,
arrival points avoid rendered water and colliders, and atlas-edge fallbacks remain bounded.

Crownspire landmark tests lock its atlas bounds, exact smooth footprint edge, greater-than-
skyline summit relief, and agreement between detailed, 1,536 m LOD, and horizon height
samplers. They also verify the shared trail endpoints, 11–12 km length, dense longitudinal
and lateral grade bounds, terrain clearing, chunk clipping, narrow dirt ribbon, discovery ID,
fast-travel entry, and non-stealing navigation registration.

Sunscar Canyon tests lock its atlas bounds, exact zero-influence edges, greater-than-650 m
rim relief, and agreement between detailed, 1,536 m LOD, and horizon samplers. They also
verify every persistent river span clears its carved banks, dry below-sea-level walls are not
classified as water, the shared rim trail clips into streamed chunks, and the fixed 136-triangle
river surface is disposed with the world. Gateway coverage keeps Crownstep and Rimstead,
their buildings, arrivals, trade links, and service spurs outside steep landmark terrain.

Collision tests cover high-speed tunneling, exact tangents, wall sliding, thin walls,
axis-aligned and rotated buildings, rounded corner hits and near misses, perpendicular-wall
seams, invalid-spawn depenetration, collider-order independence, repeated corner pressure,
malformed input, and randomized high-speed crossings. Spatial-index property tests compare
indexed results with brute force. World-streaming tests then verify one unique collider per
rendered building, tree, rock, ruin, and landmark; exact render-matrix geometry; road
clearance; opening accessibility; and immediate collider removal after harvesting.

Road-surface tests keep the presentation layer deterministic, finite, terrain-conforming,
bounded to four-meter longitudinal steps, continuously colored and lit across chunk seams,
and dry over authored river crossings. Trail coverage confirms narrow shoulder treatment,
terrain conformance, and explicit exclusion from bridge behavior. World-streaming coverage also requires every visible
road mesh to carry indexed geometry and a complete vertex-color channel without changing the
existing path-clearance contract.

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
storm-lightning switch to its default-on state. Player-sandbox unit coverage locks 1×/5×/20×
movement, normalized pitch-aware flight, vertical controls, collision/gravity bypass, and shared
state reset. The functional browser flow additionally proves invincibility blocks a fatal fall,
active cheats remain visible after closing the console, and disabling developer mode lands safely.
Session-profile coverage locks the fresh noon/fair/frozen developer launch, its 20× fly and
invincibility defaults, full gameplay reset, and the invariant that an isolated developer run
cannot modify a previously saved survey.
