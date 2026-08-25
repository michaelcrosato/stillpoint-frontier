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
- `settings` defines the complete action catalog and normalized view, control, audio,
  quality, horizon, and keybinding preferences. `PreferencesStore` keeps those local
  preferences in a version-one slot separate from world progression, so resetting or
  loading a game does not silently replace the player's controls. Rebinding swaps a
  conflicting action instead of leaving duplicate or unbound controls, and `InputManager`
  exposes actions rather than hard-coded keys to gameplay systems.
- `FeatureRegistry` is the public extension seam. A new gameplay feature installs one or
  more ordered systems without editing the engine kernel.
- `SystemPipeline` executes systems in stable phase order. The current feature contributes
  player control, player condition, chunk streaming, location discovery, navigation,
  scanning, interaction, equipment, environment, and environmental-audio systems.
- `ChunkManager` maintains a 9×9 visual ring, creates deterministic chunk content from
  the world seed and integer chunk coordinates, and owns every render resource that must
  be disposed when a chunk leaves the ring. Collider and target caches remain limited to
  the inner 5×5 gameplay ring so the doubled horizon does not inflate fixed-step work. Every
  rendered solid is paired with a circle or exact oriented-box collider from the same recipe;
  a 16 m uniform grid narrows each swept movement query. Placement reserves roads, water,
  beacons, opening objectives, and existing solids before an instance becomes visible.
- `HorizonRenderer` is an independent render-only clipmap outside that 9×9 ring. Three
  saved profiles build at most four concentric terrain LODs, split into small cardinal tiles
  for frustum culling, plus fewer than 200 deterministic settlement silhouettes. The
  layer never owns interiors, individual resources, collision, targets, citizens, or
  shadows. The near LOD follows chunk crossings while outer LODs snap to progressively
  coarser cells and are reused, so walking does not rebuild the atlas horizon every 96 m;
  changing the profile cannot expand gameplay streaming or recreate city travel stalls.
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
- `LocationDiscoverySystem` resolves the most specific current place in priority order:
  settlement, Field Unit Compound, then biome. Its catalog uses stable IDs and descriptive
  records, while the persisted discovered-ID set drives first-entry notifications and map
  treatment without changing the immutable world atlas.
- `EnvironmentalAudio` owns one lazily unlocked Web Audio graph. Procedural filtered-noise
  beds react to wind, precipitation, wildlife activity, and nearby settlement density;
  footsteps are selected from biome/shelter surfaces and emitted by distance traveled, and
  short synthesized cues acknowledge collection, harvesting,
  doors, records, inspection, discovery, damage, recovery, and saves. The graph has separate
  master, ambient, and effects gains, stops dynamic beds while paused, and is disabled in
  deterministic test mode; no downloaded audio asset or per-frame node churn is required.
- `world/vegetation` is the catalog and low-poly geometry factory for twelve woody species
  and seven ground-cover families. `ChunkManager` preserves the original tree placement
  stream and persistent IDs, selects tree appearance from a separate style seed, and batches
  each species. Decorative reeds, ferns, heather, sage, succulents, dune grass, and meadow
  plants are instanced, non-solid, and separately seeded so they cannot reshuffle resources.
- `NavigationService` is an engine-level destination registry shared by player map pins,
  quest objectives, scripted routes, and system alerts. It owns activation, finite target
  validation, one-shot arrival events, and source metadata; `NavigationSystem` evaluates
  arrival after movement without coupling quest logic to the HUD.
- `EnvironmentSystem` advances a persisted accelerated clock through the fixed-step
  pipeline. `environment/model` derives daylight and biome weather from world minutes,
  climate, and seed; the Three runtime presents one key light, shader sky, fog, static
  stars, and a single GPU precipitation field without wall-clock dependence.
- `world/fastTravel` is a temporary playtest adapter over the immutable settlement and
  relay catalog. It resolves deterministic dry arrival offsets against the active collider
  cache, leaving future discovery rules free to filter the catalog independently.
- `world/roads` is the shared path layer for rendered roads, urban street grids, building
  clearance, and pedestrian lanes. The Old Relay Spur makes the opening survey site a
  credible quiet work stop without promoting it to a settlement.
- `macroWorld` is the immutable atlas layer: a 96×96 km territory with seven biomes,
  the Greywater river/estuary, 24 economically grounded settlements, and a connected
  hierarchy of trunk, regional, and local roads. Chunks clip those features into local
  render recipes; the complete map is never resident as geometry.
- Pure modules (`terrain`, `random`, `collision`, `locomotion`, `interactions`, and `state`) contain simulation rules that
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
- `world/spawnFeatures` composes deterministic interior props, colliders, workbenches,
  containers, beds, scanner subjects, and authored personnel around the three opening
  buildings. Layout validation shares the authored footprints and reserves every door,
  landing, aisle, and stairwell so future content additions fail tests instead of blocking
  traversal.
- `GameShell` translates serializable engine snapshots into the HUD, map, pause, inventory,
  settings, inspection, contracts, crafting, field-guide, dialogue, container, rest,
  incapacitation, location-discovery, and error interfaces. A separate
  tiny presentation store publishes heading, bearing,
  distance, and near-target screen projection once per rendered frame, so the scrolling
  compass remains smooth without repainting the entire shell at 60+ Hz. The renderer never
  reaches into React state.

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
The version-eight envelope retains survey records, inventory, sparse entity and door state,
the manual map waypoint, total world minutes, the last horizon mode, player position and
look direction, health/wetness/cold stress, discovered locations, contract progress, field-guide
records, partially looted containers plus durable loot evidence, placed structures, recipe unlocks, NPC flags, and the
last rest time. Versions one through seven migrate in place and every field is bounded and
normalized independently; a newer-version payload is never overwritten by an older client.
Static definitions, NPC schedule positions, weather, and animal
reaction state remain derived rather than stored. The engine
autosaves during active play every 30 seconds and on material state changes, exposes explicit
Save Now and Load Last Save actions, and rebuilds generated world state before relocating the
player on load. Settings are also written immediately to the separate preferences slot; the
saved horizon remains a legacy migration fallback only when no preference exists.
Quest destinations and survey-marker targets are rebuilt from restored progression after load.

The atlas uses `+X = east`, `-Z = north`, and north-zero clockwise bearings. Map clicks are
converted through tested bidirectional atlas helpers. The compass builds a local unwrapped
five-degree tick window around camera yaw, which preserves continuous motion through the
359°/000° seam. Waypoint guidance always provides distance, absolute bearing, relative
bearing, map placement, and an arrival latch; nearby in-view targets also receive a
projected world marker.

Movement treats player position as feet rather than camera position. The controller owns
gravity, grounded state, jump velocity, crouch eye height, sprint state, stamina, and a
recovery delay. It adds a 120 ms jump buffer, 100 ms coyote window, smoothed crouch eye
height, head-clearance checks before standing, settings-driven look sensitivity/inverted Y,
and an encumbrance speed multiplier. Horizontal movement continuously sweeps the circular
player footprint against circle and oriented-box colliders with authored vertical bounds, resolves the earliest time of
impact, slides along rounded corners, and deterministically depenetrates invalid streamed or
saved positions.
The movement solver remains a planar sweep selected by the player's vertical interval; this
leaves a clean seam for capsule movement, slopes, climbing, or vehicles without coupling those
ideas to React or world generation.

## Performance contract

The initial target is an RTX 3060-class machine at 1440p/60:

- Fixed simulation: 60 Hz, with large frame deltas clamped and spiral-of-death protection.
- Resident terrain: 81 chunks in a 9×9 visual ring; decorative props are instanced per chunk.
- Far terrain: 16–64 frustum-cullable HLOD tiles, under 60,000 triangles and 200 settlement
  proxies. Standard reaches 1.84 km, Extended 12 km, and Unlimited the finite atlas horizon
  at 70 km, with reverse-depth used when the browser exposes `EXT_clip_control`.
- Gameplay queries, ambient citizens, and sparse wildlife: independent 25-chunk inner rings.
- Collision broad phase: streamed 16 m spatial cells, followed by swept-circle narrow phase;
  city cost scales with nearby candidates rather than every solid in the gameplay ring.
- Atlas territory: 9,216 km²; the full map is never resident.
- Roads, settlement blocks, biome flora, rocks, water, ruins, citizens, and animals use static or instanced
  meshes; no gameplay object requires an animation clip.
- Citizen matrices present once per rendered frame with fixed-step interpolation, so they
  remain smooth on 60 Hz and high-refresh displays. Performance mode reduces population
  density rather than motion cadence. Hard resident targets remain 5,000 and 2,200 visible
  citizens respectively, with no citizen shadows.
- Wildlife is capped at 72 rigid instances in cinematic/Ultra mode and 36 in performance mode,
  spread across no more than six candidates per chunk with no shadows, pathfinding, or
  persistent AI; each visible resident carries only a bounded four-mode reaction record.
- One shadow-casting directional sun/moon key; 2K shadow map in cinematic and 4K in Ultra. Dynamic
  weather changes palette, fog, exposure, and one shader-driven precipitation field.
- Persistent field torches keep emissive markers while only the nearest 12 cinematic/Ultra or six
  performance lights activate at night, bounding renderer light growth as camps accumulate.
- The optional phone light reuses two persistent spotlights across toggles. Its unshadowed
  spill is limited to 11 m to reduce light leaks; performance mode disables its single 1K
  core shadow while preserving the beam.
- Environmental audio reuses one gesture-unlocked context, four persistent procedural
  ambience loops, and short-lived one-shot footstep/cue nodes. Paused or blocked audio is a
  contained capability failure and never blocks simulation or rendering.
- Pixel ratio is capped at 1.75 in cinematic, 2 in opt-in Ultra, and 1 in performance;
  performance disables shadows.
- Detailed terrain and render-only horizon geometry use the same deterministic world-space
  color sampler. Roads, settlement facades, and rocks use restrained category palettes with
  no chunk- or instance-order inputs, preventing streaming seams and reload color changes.
- A camera-centered procedural sky renders sun/moon discs, horizon glow, and multi-layer
  wind-driven clouds without texture assets. One shared world-space water shader renders all
  river and sea chunks with seamless ripples, Fresnel tinting, and weather-aware sun glint.
- Renderer diagnostics expose FPS, active chunks, selected horizon, far tiles, far triangles,
  settlement proxies, and optical visibility to the HUD and tests. Weather remains the final
  visibility limit, with fog and storms restoring dense extinction in every profile.
- Every unloaded chunk explicitly disposes geometries and materials.

The next production hardening modules are worker-based chunk recipes, floating-origin
rebasing, shared asset reference counting, vertical capsule
collision, and authored road routing around water and grades. Their boundaries already
align with the present world, system, and feature layers.
