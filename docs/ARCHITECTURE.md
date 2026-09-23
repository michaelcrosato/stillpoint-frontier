# Stillpoint Frontier architecture

Stillpoint Frontier is intentionally built around low-animation gameplay. There are no
skeletal rigs, animation clips, `AnimationMixer` instances, or ambient-character state
machines in the engine core. Variety comes from deterministic terrain, sightlines,
discovery, lighting, navigation, state changes, and rigid instanced citizens translating
along authored procedural lanes. Ambient animals use the same rigid analytic approach:
they walk or glide without skeletons, clips, or pathfinding. A small transient reaction reducer
adds alert, flee, and return modes while keeping presentation rigid and unsaved.

## Runtime layers

- `Engine` owns the WebGL renderer, fixed 60 Hz simulation clock, lifecycle, diagnostics,
  pause/context-loss behavior, save/load orchestration, player-facing overlays, and the
  narrow deterministic test bridge.
- `camera/CameraRig` owns one continuous, saved-local view distance. Its semantic bands are
  exact first person, over-shoulder third person, and an elevated isometric-style perspective.
  The existing perspective render camera remains stable for the post-processing pipeline,
  while a separate player-eye camera preserves locomotion, interaction, scanning, flashlight,
  and audio contracts. A bounded sphere sweep against terrain, height-aware world colliders,
  and authored overhead floors/roofs retracts the camera immediately and releases it smoothly; teleports and recovery snap both
  poses. Displaced views project the authoritative player-eye aim ray back into screen space,
  so their reticle stays truthful without moving gameplay origin. `camera/PlayerAvatar` adds
  only a rigid render silhouette outside first person.
  The requested semantic mode is a UI label, not evidence that the camera has reached
  its endpoint. Reticle placement uses the render-frame presentation stream until
  distance reaches zero. Near-zero pitch blending preserves extreme player look angles.
  Authored surface sweeps query the lowest support at or above each subsegment's
  inclusive lower bound and test both travel directions; they do not reuse the
  player-foot reference that selects walkable stairs.
- `settings` defines the complete action catalog and normalized interface scale, view, control,
  audio, quality, horizon, world-detail, and keybinding preferences. `PreferencesStore` keeps those local
  preferences in a version-one slot separate from world progression, so resetting or
  loading a game does not silently replace the player's controls. Rebinding swaps a
  conflicting action instead of leaving duplicate or unbound controls, and `InputManager`
  exposes actions rather than hard-coded keys to gameplay systems.
  Optional C/right-Ctrl/right-Shift aliases yield to explicit bindings. Resolved key
  lists are cached until bindings change. Handled UI events do not enter gameplay.
  Captured gameplay accepts restored HUD button focus, while text-entry targets
  remain protected. Map Ctrl/Cmd shortcuts and modified wheels belong to the browser.
- `FeatureRegistry` is the public extension seam. A new gameplay feature installs one or
  more ordered systems without editing the engine kernel.
- `SystemPipeline` executes systems in stable phase order. The current feature contributes
  player control, player condition, chunk streaming, location discovery, navigation,
  scanning, interaction, equipment, environment, and environmental-audio systems.
- `ChunkManager` maintains a 9×9 visual ring, creates deterministic chunk content from
  the world seed and integer chunk coordinates, and owns each chunk's own render resources,
  disposed when the chunk leaves the ring. Geometry and materials that are identical in
  every chunk come from a `ChunkAssetCache`: each chunk holds a lease on the assets it
  uses, and an asset is disposed when its last lease is released. A chunk builder that
  throws leaves nothing behind: its partial tree is disposed, its lease released, and the
  next update retries it. Collider and target caches remain limited to
  the inner 5×5 gameplay ring so the doubled horizon does not inflate fixed-step work. Every
  rendered solid is paired with a circle or exact oriented-box collider from the same recipe;
  a 16 m uniform grid narrows each swept movement query. Placement reserves roads, water,
  beacons, opening objectives, and existing solids before an instance becomes visible.
  Departing chunks are retired before arrivals, keeping teleport residency within
  the same 81-chunk bound. A center is marked complete only after loading succeeds;
  gameplay caches refresh even when a load fails. Mid-factory allocation cleanup
  and automatic Engine recovery from streaming exceptions remain separate work.
- `world/benchmarkZone` and `developer/ForestStressTest` form a technical proving ground,
  not a content location. Grid `64:-60` carries one analytic shallow lake, a cleared shore
  approach, a persistent shared-water lake surface, and a lazily resident seven-by-seven
  tile canopy. Six bounded session-only stops include a zero-instance baseline, then scale
  from 1,500 to 20,000 trees and 6,000 to 80,000 understory instances. Each
  tile selects full, simplified, or silhouette tree geometry through `THREE.LOD`; only
  near trees cast shadows and only near tiles draw ground cover and rocks. The additional
  vegetation is render-only: it contributes no targets, colliders, harvest IDs, AI,
  discoveries, or save data. Ordinary sparse harvestable vegetation remains the physical
  gameplay layer. The canopy is developer-gated; leaving the site or disabling developer
  mode disposes all instance buffers while shared fixture assets remain owned by the module
  until engine shutdown. Developer travel preserves the pre-lab pose for normal saves.
- `HorizonRenderer` is an independent render-only clipmap outside that 9×9 ring. Three
  saved distance profiles build at most four concentric terrain LODs, split into small cardinal tiles
  for frustum culling, plus deterministic settlement silhouettes. A separate five-stop
  world-detail policy refines the first ring from 48 m to 12 m cells and adds capped,
  instanced tree and rock silhouettes between the populated world and macro horizon. Its
  scale-aware height and color sampling removes frequencies that a coarse grid cannot resolve,
  preventing middle-distance alias bands at every slider stop. The
  layer never owns interiors, individual resources, collision, targets, citizens, or
  shadows. The near LOD follows chunk crossings while outer LODs snap to progressively
  coarser cells and are reused, so walking does not rebuild the atlas horizon every 96 m;
  changing the profile cannot expand gameplay streaming or recreate city travel stalls.
  A ring whose inner edge the rendered fog fully hides is not drawn.
  Crownspire adds one 216-triangle, camera-relative upper-landform proxy beyond those rings.
  It preserves the landmark's true bearing and angular size inside the active far plane,
  fades out as the physical terrain becomes resident, and responds to horizon color, cloud,
  rain, dust, and night instead of weakening global fog.
  Sunscar Canyon remains part of the analytic terrain at every LOD; one persistent
  136-triangle river ribbon is the only added draw surface and carries no simulation.
- `CitizenEngine` independently streams a 5×5 resident ring. Its pure recipes place
  proportional crowds only on settlement sidewalks or road shoulders, while one shared
  low-poly figure and one instanced draw per populated chunk keep Vesper Crown's thousands
  of visible citizens within budget. Citizens never enter target, collider, dialogue, or
  persistence systems.
- `AnimalEngine` independently streams another 5×5 render-only ring. Pure habitat recipes
  select sparse biome-native groups outside settlement cores and roads. A handful of shared
  rigid primitive models move along smooth analytic routes each rendered frame. Per-resident
  transient reaction state lets nearby animals alert, flee, and return without skeletons or
  persistent AI. Ground reactions pass through a narrow deterministic navigation adapter that
  resamples terrain, clips water crossings, and queries streamed solids without registering
  animals as colliders. Lightweight scan candidates expose presented poses without creating
  scene nodes; wildlife never enters dialogue, inventory, or save state.
- `PlayerFlashlight` is a reusable field-equipment module rather than environment state.
  A camera-aligned 48 m warm core and short cool spill provide a phone-style beam; only the
  core casts a 1K cinematic or 2K Ultra shadow, and only while enabled in a shadowed quality. The spotlight shader
  path is prewarmed behind the boot screen so first activation cannot introduce a traversal
  hitch. `PlayerEquipmentSystem` consumes one edge-triggered `L` press during active play.
- `PlayerConditionSystem` runs immediately after movement. It samples authored shelter and
  the deterministic atmosphere to advance wetness and cold stress, applies thresholded fall
  damage from landing velocity, derives HUD tags, and pauses play on incapacitation. A
  recovery action resets health, exposure, stamina, and position to the Field Unit Compound.
  Inventory weight crosses an explicit encumbrance threshold and feeds back into locomotion.
- `developer/PlayerSandbox` owns session-only playtest traversal policy. The master developer
  switch gates invincibility, discrete 5×/20× movement tiers, and fly/no-clip controls. Flight
  follows camera pitch, uses Space and Ctrl/C for world-up movement, clamps to the finite atlas,
  never persists an airborne pose, and returns to the last stable grounded position when disabled.
- `session/sessionPresets` owns shared spawn coordinates and launch policy. The title-screen
  developer quick start rehydrates a genuinely empty runtime at the Field Unit, then applies
  noon, clear weather, frozen time, invincibility, 20× movement, and fly/no-clip as one profile.
  Its explicit ephemeral persistence policy protects the ordinary survey save from gameplay
  actions, autosave, visibility changes, and disposal while preserving local settings.
- `LocationDiscoverySystem` resolves the most specific current place in priority order:
  settlement, Field Unit Compound, authored terrain landmark, then biome. Its catalog uses stable IDs and descriptive
  records, while the persisted discovered-ID set drives first-entry notifications and map
  treatment without changing the immutable world atlas.
- `EnvironmentalAudio` owns one lazily unlocked Web Audio graph. Procedural filtered-noise
  beds react to wind, precipitation, wildlife activity, and nearby settlement density;
  footsteps are selected from biome/shelter surfaces and emitted by distance traveled, and
  short synthesized cues acknowledge collection, harvesting,
  doors, records, inspection, discovery, damage, recovery, and saves. The graph has separate
  master, ambient, and effects gains, stops dynamic beds while paused, and is disabled in
  deterministic test mode; no downloaded audio asset or per-frame node churn is required.
  Pointer-lock pause, tab hiding, and context loss call `silenceAmbient()` directly:
  scheduled gain ramps are cancelled and all four beds are zeroed without waiting
  for another simulation frame. Active mixing restores the beds.
- `world/vegetation` is the catalog and low-poly geometry factory for twelve woody species
  and seven ground-cover families. `ChunkManager` preserves the original tree placement
  stream and persistent IDs, selects tree appearance from a separate style seed, and batches
  each species. Decorative reeds, ferns, heather, sage, succulents, dune grass, and meadow
  plants are instanced, non-solid, and separately seeded so they cannot reshuffle resources.
- `NavigationService` is an engine-level destination registry shared by player map pins,
  quest objectives, scripted routes, and system alerts. It owns activation, finite target
  validation, one-shot arrival events, and source metadata; `NavigationSystem` evaluates
  arrival after movement without coupling quest logic to the HUD.
- `cartography/viewport` is the renderer-independent map-camera contract. It keeps the square
  atlas aspect-correct inside any panel, converts world and screen coordinates bidirectionally,
  anchors zoom beneath the cursor, clamps panning to atlas bounds, focuses known destinations,
  and exposes semantic atlas/regional/local detail levels. `GameShell` owns this presentation
  state so closing the map does not reset the player’s view; it never enters the game save.
- `EnvironmentSystem` advances a persisted accelerated clock through the fixed-step
  pipeline. `environment/model` derives daylight and biome weather from world minutes,
  climate, and seed; the Three runtime presents one key light, shader sky, fog, static
  stars, and a single GPU precipitation field without wall-clock dependence.
- `world/fastTravel` is a temporary playtest adapter over the immutable settlement, relay,
  and authored-landmark catalog. It resolves deterministic dry arrival offsets against the active collider
  cache, leaving future discovery rules free to filter the catalog independently.
- `world/roads` is the shared path layer for rendered roads, urban street grids, building
  clearance, and pedestrian lanes. `RoadSurfaceGeometry` turns those unchanged centerlines
  into one indexed surface per streamed chunk: four-meter longitudinal sampling follows the
  analytic terrain, a shallow crown and biome-colored shoulders soften the edges, stable
  overlap bias removes intersection flicker, and broad river approaches ease trade roads onto
  a dry deck. Absolute-world height, normal, and color sampling keeps adjacent chunks seamless.
  The Old Relay Spur makes the opening survey site a credible quiet work stop without promoting
  it to a settlement. Crownspire's summit trail and Sunscar's rim trail reuse this surface
  pipeline and its placement clearance. Short service spurs join Crownstep and Rimstead to
  those trailheads without treating the trails as citizen trade roads.
- `world/mountainLandmark` is Crownspire's single source of truth: a 5.76 km analytic
  footprint, roughly 1.2 km summit relief, trailhead and summit coordinates, and an 11.3 km
  switchback polyline. Detailed terrain carves a walkable shoulder along the route while
  coarse LOD samplers retain only its broad mass. Terrain, surface color, map geography,
  navigation, discovery, fast travel, streamed trail geometry, and horizon presentation all
  consume the same immutable definition; the landmark adds no resident AI or simulation ring.
- `world/canyonLandmark` is Sunscar Canyon's renderer-independent source of truth: a
  17.3 km terraced analytic cut with roughly 680 m relief, a meandering carved river bed,
  a 7.3 km rim trail, an overlook, vegetation/placement policy, and an elliptical discovery
  boundary. Detailed terrain, HLOD, surface color, water, map geography, navigation,
  discovery, fast travel, and streamed trail geometry all consume the same definition.
  `world/authoredLandmarks` exposes both landmark waypoints through one extensible registry.
- `macroWorld` is the immutable atlas layer: a 96×96 km territory with seven biomes,
  the Greywater river/estuary, 26 economically grounded settlements, and a connected
  hierarchy of trunk, regional, and local roads. Crownstep and Rimstead are village-budget
  landmark gateways with visible map labels and two independent road approaches each. Chunks clip those features into local
  render recipes; the complete map is never resident as geometry.
- Pure modules (`terrain`, `random`, `collision`, `locomotion`, `camera/CameraRig`, `interactions`, and `state`) contain simulation rules that
  are testable without React, a browser, or a GPU. The same rule applies to settings,
  player-condition, interaction-prompt, audio-model, items, contracts, crafting, field-guide,
  loot, rest, wildlife reactions, progression, and location-discovery modules.
- `InteractionSystem` performs one nearest-target selection pass and publishes a unified
  `WorldTarget` contract for resources, pickups, doors, records, workbenches, containers,
  rest sites, scannables, and authored NPCs. Short bounded line-of-sight tests against terrain
  and vertical collider prisms prevent interactions and scans through walls or floors. Prompt
  copy is derived from target action plus current bindings. `world/inspectables` adds stable,
  low-cost readable records at the starting compound; opening one pauses simulation and
  presents its title, source, and body through the same interaction path.
  Scanner selection applies its distance/alignment score before visibility queries.
  Only a candidate that can beat the best visible subject needs terrain/collider
  checks. A blocked subject never prevents another candidate from winning.
- `gameplay/items` is the inventory catalog and arithmetic seam. Every material and usable
  field item has a stable ID, stack limit, category, description, unit weight, and optional
  use behavior. `gameplay/crafting`, `loot`, and `resting` are pure outcome reducers;
  `deployments` turns validated persistent placement records into one owned scene subtree.
- `gameplay/events` is the shared progression seam. Gathering, scanning, crafting, looting,
  placement, resting, inspection, location discovery, and named-NPC contact emit typed events.
  The ordered contract reducer consumes those events without importing world, UI, or renderer
  code. `gameplay/contractEvidence` reconciles ordered objectives from durable facts so doing a
  one-time action early cannot soft-lock a contract. Static contracts, recipes, guide records,
  loot tables, dialogue, and interior layouts stay data-driven; only bounded progress is serialized.
  Notifications from one container transfer are reduced as one batch before evidence
  reconciliation to avoid double-crediting inventory. Separate player actions still
  reconcile immediately so ordered objectives advance before the next action.
- `world/spawnFeatures` composes deterministic interior props, colliders, workbenches,
  containers, beds, scanner subjects, and authored personnel around the three opening
  buildings. Layout validation shares the authored footprints and reserves every door,
  landing, aisle, and stairwell so future content additions fail tests instead of blocking
  traversal.
- `GameShell` translates serializable engine snapshots into the HUD, map, pause, inventory,
  settings, inspection, contracts, crafting, field-guide, dialogue, container, rest,
  incapacitation, location-discovery, and error interfaces. A separate
  tiny presentation store publishes heading, bearing, distance, and near-target screen projection
  once per rendered frame, so the scrolling compass remains smooth without repainting the entire
  shell at 60+ Hz. The top-center navigation instrument combines day, time, absolute waypoint
  bearing, and distance above that compass; relative bearing drives its center marker and edge
  arrows. It deliberately replaces the separate radar and floating waypoint card. The renderer
  never reaches into React state.
  `ui/dialogFocus` supplies one modal boundary policy, including initial heading focus,
  disabled/hidden controls, and single-control inspection dialogs.
- `rendering/GpuFrameTimer` wraps the complete presented frame in a non-blocking
  `EXT_disjoint_timer_query_webgl2` query only during an active capture. It polls once on
  later frames, caps outstanding queries, discards disjoint epochs, and never stalls the GPU.
  The pure
  `developer/GraphicsBenchmark` collector excludes shader warmup, joins delayed samples by
  frame token, and reports rAF, CPU work, CPU render submission, GPU, draw-call, and submitted
  triangle percentiles. Captures freeze their quality, LOD, framebuffer, load, viewpoint,
  environment, browser, and GPU context so completed reports cannot be mislabeled. Captures
  and reports are session-only.

## Adding a feature

Implement systems behind a feature and install them through the registry:

```ts
const archaeologyFeature: GameFeature<GameRuntimeContext> = {
  id: "archaeology",
  install(registry) {
    registry.system(new ArtifactSpawnSystem()).system(new ArtifactScanSystem());
  },
};
```

New chunk decoration should derive its PRNG from
`world seed + chunk coordinates + feature namespace`. Never use `Math.random()`, load
completion order, or frame time to determine persistent world content.

Persistent resource IDs include the feature, recipe version, chunk coordinate, and local
index. Pickups, trees, and rock outcrops are reduced through a pure idempotent interaction
function. Only a sparse `{hits, removed}` world delta is saved; generated chunks remain
derivable. Inventory and its matching entity delta are written in the same save operation.
A complete yield must fit before the resource is removed; otherwise prior work remains
and no collection event is emitted. Rest objectives count actual event duration, not
timestamp-only evidence. Last-write status and readable-save availability are independent.
The version-eight envelope retains survey records, inventory, sparse entity and door state,
the manual map waypoint, total world minutes, the last horizon mode, player position and
look direction, health/wetness/cold stress, discovered locations, contract progress, field-guide
records, partially looted containers plus durable loot evidence, placed structures, recipe unlocks, NPC flags, and the
last rest time. Versions one through seven migrate in place and every field is bounded and
normalized independently; a newer-version payload is never overwritten by an older client.
Player and placement heights share `world/heightBounds`: −1,000 to 5,000 m.
The lower bound includes the dry Sunscar Canyon floor below −600 m. Validate
new authored terrain against this contract before release.
Static definitions, NPC schedule positions, weather, and animal
reaction state remain derived rather than stored. The engine
autosaves during active play every 30 seconds and on material state changes, exposes explicit
Save Now and Load Last Save actions, and rebuilds generated world state before relocating the
player on load. Settings are also written immediately to the separate preferences slot; the
saved horizon remains a legacy migration fallback only when no preference exists.
Horizon changes and Reset Settings write only preferences. They must not create
or replace a survey save. `gameplay/crafting.craftingStatus` is the common
availability rule for fabrication controls and the inventory transaction. An
output stack at capacity is distinct from a missing ingredient.
Quest destinations, authored terrain-landmark trailheads, and survey-marker targets are rebuilt
from restored progression after load.
Developer quick-start sessions reuse the same empty-save factory and world rehydration path but
are explicitly ephemeral: they can inspect and mutate the runtime without writing the normal
survey slot. Loading a normal save exits that sandbox and restores ordinary persistence policy.

The atlas uses `+X = east`, `-Z = north`, and north-zero clockwise bearings. Map clicks are
converted through tested bidirectional atlas helpers. The compass builds a local unwrapped
five-degree tick window around camera yaw, which preserves continuous motion through the
359°/000° seam. Waypoint guidance always provides distance, absolute bearing, relative bearing,
map placement, and an arrival latch. The HUD keeps guidance instrument-like: bearing and distance
are read above the compass while relative direction is shown on the compass tape.

Movement treats player position as feet rather than camera position. The controller owns
gravity, grounded state, jump velocity, crouch eye height, sprint state, stamina, and a
recovery delay. It adds a 120 ms jump buffer, 100 ms coyote window, smoothed crouch eye
height, head-clearance checks before standing, settings-driven look sensitivity/inverted Y,
and an encumbrance speed multiplier. Horizontal movement continuously sweeps the circular
player footprint against circle and oriented-box colliders with authored vertical bounds, resolves the earliest time of
impact, slides along rounded corners, and deterministically depenetrates invalid streamed or
saved positions.
Developer speed tiers multiply that same swept grounded path after normal gait and encumbrance
policy at 5× or 20×. Fly/no-clip is an explicit alternate branch that bypasses gravity, collision, fall damage,
footsteps, and stamina while retaining the same camera and streamed-world update contracts.
The movement solver remains a planar sweep selected by the player's vertical interval; this
leaves a clean seam for capsule movement, slopes, climbing, or vehicles without coupling those
ideas to React or world generation.

## Performance contract

The initial target is an RTX 3060-class machine at 1440p/60:

- Fixed simulation: 60 Hz, with large frame deltas clamped and spiral-of-death protection.
- Resident terrain: 81 chunks in a 9×9 visual ring; decorative props are instanced per chunk.
- Far terrain: 16–64 frustum-cullable HLOD tiles. The saved world-detail slider ranges from
  a sub-60,000-triangle coarse ring to a hard 300,000-triangle Maximum budget with no more
  than 2,600 visual-only scenery recipes and 200 settlement proxies. Standard reaches 1.84 km,
  Extended 12 km, and Unlimited the finite atlas horizon
  at 70 km, with reverse-depth used when the browser exposes `EXT_clip_control`.
- Crownspire's beyond-range silhouette is one non-shadowing 216-triangle mesh; it does not
  increase resident chunks, settlement proxies, scenery instances, colliders, or fixed-step work.
- Sunscar's canyon relief reuses the terrain draw budget; its persistent 136-triangle river
  adds one shared-water draw surface and no resident chunks, colliders, targets, or AI.
- Gameplay queries, ambient citizens, and sparse wildlife: independent 25-chunk inner rings.
- Collision broad phase: streamed 16 m spatial cells, followed by swept-circle narrow phase;
  city cost scales with nearby candidates rather than every solid in the gameplay ring.
- Atlas territory: 9,216 km²; the full map is never resident.
- Roads, settlement blocks, biome flora, rocks, water, ruins, citizens, and animals use static or instanced
  meshes; no gameplay object requires an animation clip.
- Citizen matrices present once per rendered frame with fixed-step interpolation, so they
  remain smooth on 60 Hz and high-refresh displays. Performance mode reduces population
  density rather than motion cadence. Hard resident targets remain 5,000 and 2,200 visible
  citizens respectively. Citizens cast nothing into the shadow map; one instanced draw of
  soft blob shadows, twice each body's footprint, grounds up to 512 of them within 56 m.
- Wildlife is capped at 72 rigid instances in cinematic/Ultra mode and 36 in performance mode,
  spread across no more than six candidates per chunk with no shadow-map shadows,
  pathfinding, or persistent AI (walking animals get blob shadows within 72 m); each visible resident carries only a bounded four-mode reaction record.
  AnimalEngine recomputes each species' culling sphere from the presented instance
  matrices. This covers moving animals on Crownspire and below sea level in Sunscar;
  a fixed sphere near sea level does not. The extra bound calculation visits at most
  72 instances per presented frame and adds no draw calls or resident animals.
- One shadow-casting directional sun/moon key; 2K shadow map in cinematic and 4K in Ultra. The
  sun and moon keys crossfade through twilight. The sun shadow map is cached: it re-renders
  when the light turns more than 0.0005 rad, the player moves more than 1 m, a caster reports
  a change (chunk streaming, harvests, doors, placements, the avatar, the forest lab), the
  WebGL context is restored, or 30 evaluations pass. Presets without shadows release the
  maps. Dynamic weather changes palette, fog, exposure, and one shader-driven precipitation field.
- Persistent field torches keep emissive markers while only the nearest 12 cinematic/Ultra or six
  performance lights activate at night, bounding renderer light growth as camps accumulate.
- The optional phone light reuses two persistent spotlights across toggles. Its unshadowed
  spill is limited to 11 m to reduce light leaks; performance mode disables its single 1K
  core shadow while preserving the beam. Whenever a frame compiles new programs, the scene
  is compiled once more in the beam's other pose, so switching it seldom compiles; where
  `KHR_parallel_shader_compile` exists that work stays off the main thread.
- Environmental audio reuses one gesture-unlocked context, four persistent procedural
  ambience loops, and short-lived one-shot footstep/cue nodes. Paused or blocked audio is a
  contained capability failure and never blocks simulation or rendering.
- Pixel ratio is capped at 1.75 in cinematic, 2 in opt-in Ultra, and 1 in performance;
  performance disables shadows. Where GPU timer queries exist, adaptive resolution renders
  at 0.6 to 1 of that pixel ratio. From GPU time sampled every 15th frame, it steps down by
  0.1 after sustained time over 1.25× the 60 fps budget and back up under 0.6×. It holds
  still through benchmarks and is off in test mode.
- The sun/moon shadow anchor is quantized in its light plane at the active shadow-map
  texel size. The light and target move together, preserving direction while preventing
  sub-texel shadow crawling; a session-only developer switch exposes the unstabilized path.
- Detailed terrain and render-only horizon geometry use the same deterministic world-space
  color sampler. Roads, settlement facades, and rocks use restrained category palettes with
  no chunk- or instance-order inputs, preventing streaming seams and reload color changes.
- `WorldMaterialLibrary` composes tagged PBR policies with reversible shader modules:
  root tracking applies current policy only to newly retained materials; existing
  shared references do not trigger a registry-wide rewrite. Environment/quality
  changes still update the registry as needed. The shader modules provide
  periodic, distance-faded surface micro-detail, broad moving cloud shade, spatial rain pooling,
  and weather-driven GPU vegetation bending. Wet pooling darkens and lowers roughness only on
  nearby upward-facing exposed patches so PMREM supplies the reflection instead of another pass.
  Cloud shade fades before the detailed-world boundary and costs no extra draw call. Wind uses
  one flexibility attribute per geometry, coherent
  world-position phase and expanded culling bounds. Wind-deformed shadow overrides are
  disabled; vegetation shadow silhouettes remain static. Quality strengths live in `QUALITY_PRESETS`; developer A/B switches are
  session-only and benchmark captures record their state.
- A camera-centered procedural sky renders sun/moon discs, horizon glow, and multi-layer
  wind-driven clouds without texture assets. Separate sun and moon discs are drawn only by
  the bloom pass, at 0.9 of the horizon draw distance so terrain hides their glow. One shared world-space water shader renders all
  river and sea chunks with seamless ripples, Fresnel tinting, and weather-aware sun glint.
- EnvironmentMapRuntime owns its reflection texture and borrows the renderer for PMREM
  capture. A finally block restores the prior render target, cube face, mip level,
  clear policy, tone mapping, XR flag, and capture background on success or failure.
  Failed updates retain the previous reflection and do not retry the same atmosphere
  signature each frame. This isolates renderer state; it does not prove that Three
  releases every internal allocation when capture fails partway through. Sun azimuth is
  not part of the signature: between captures the map rotates by the captured minus the
  current azimuth, because Three samples at the transpose of `envMapRotation`.
- The compositor keeps ACES/output conversion last, with independently switchable selective
  bloom, Ultra-only near-field GTAO, and a restrained atmosphere-aware grade. The grade responds
  to daylight, golden hour, cloud, rain, dust, and night without changing simulation state. If an
  optional compositor path throws, the renderer restores clear and material state, resets its
  target, and retries the direct path. ShortRangeGtaoPass also restores point/line visibility,
  camera range, and shadow policy in finally. Its small Three r185 internal visibility adapter
  needs regression checks during Three upgrades. A world-material failure still reaches the
  renderer interrupt.
  Startup uses synchronous `renderer.compile()` with render-target restoration,
  followed by the existing two warm-up renders before starting the frame loop.
  The awaited startup boundary remains, but no uncancellable Three shader-poll
  timer can survive disposal or context replacement. This trades potential boot
  blocking for a bounded resource lifetime.
- Storm weather drives a deterministic double-flash illumination policy from the simulation
  effect clock. It briefly lifts the shader sky, directional/hemisphere lighting, and final grade
  without bolt geometry, extra shadow maps, wall-clock randomness, or idle-frame GPU cost.
- Distant town, city, and megacity proxies add at most 320 deterministic window/rooftop point
  lights across no more than eight frustum-cullable draws. They are emissive bloom sources only:
  no real lights, shadows, interiors, collision, citizens, or saves. Night/cloud state controls
  their fade and a session A/B switch can remove the layer entirely.
- Renderer diagnostics expose FPS, active chunks, selected horizon, far tiles, far triangles,
  settlement proxies, optical visibility, drawing-buffer resolution/DPR, draw calls, and
  CPU/GPU render time to the HUD and tests. GPU identity and framebuffer samples are
  cached per context lifetime; frame counters come directly from renderer.info.
  A deliberate 10-second capture compares p95
  work against selectable 60–240 Hz frame budgets. CPU and GPU are pipelined, so headroom
  uses `max(CPU p95, GPU p95)`, not their sum; 1% low comes from the rAF-interval p99. GPU
  submission/resolution coverage and a minimum foreground sample count prevent partial
  query sets or single-frame hitches from producing a confident grade. If the timer extension
  is unavailable the UI explicitly labels the result CPU-only. Weather
  remains the final visibility limit, with fog and storms restoring dense extinction in
  every profile.
- The Canopy Load Lab is opt-in developer load, never a production baseline. Its maximum
  stop authors 20,000 trees, 80,000 understory instances, 1,600 rocks, and 4,096 shoreline
  reeds while keeping the 81/25/25 world, citizen, and wildlife resident rings unchanged.
  Engine-budget classifications are `PASS` at or below 75% of the target budget, `MARGIN`
  up to 90%, and `FAIL` above 90%; insufficient sampling is `INCOMPLETE`. Observed delivery
  is reported separately as `PASS`, `MISS`, or `CAP_LIMITED`, so a 144 Hz target measured on
  a stable 60 Hz display is not mistaken for an engine-budget failure. Real acceptance
  captures belong on pinned hardware.
- Every unloaded chunk disposes owned geometry/materials and releases its shared-asset lease.

The next production hardening modules are worker-based chunk recipes, floating-origin
rebasing, vertical capsule
collision, and authored road routing around water and grades. Their boundaries already
align with the present world, system, and feature layers.
