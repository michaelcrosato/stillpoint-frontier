# Stillpoint Frontier architecture

Stillpoint Frontier is intentionally built around low-animation gameplay. There are no
skeletal rigs, animation clips, `AnimationMixer` instances, or ambient-character state
machines in the engine core. Variety comes from deterministic terrain, sightlines,
discovery, lighting, navigation, state changes, and rigid instanced citizens translating
along authored procedural lanes.

## Runtime layers

- `Engine` owns the WebGL renderer, fixed 60 Hz simulation clock, lifecycle, diagnostics,
  pause/context-loss behavior, and the narrow deterministic test bridge.
- `FeatureRegistry` is the public extension seam. A new gameplay feature installs one or
  more ordered systems without editing the engine kernel.
- `SystemPipeline` executes systems in stable phase order. The current feature contributes
  player control, chunk streaming, and interaction systems.
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
  are testable without React, a browser, or a GPU.
- `GameShell` translates serializable engine snapshots into the HUD, map, pause, discovery,
  and error interfaces. A separate tiny presentation store publishes heading, bearing,
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
The version-six envelope retains the player's manual map waypoint, total world minutes,
door state, and horizon preference; versions one through five migrate in place.
Weather remains derived rather than stored. Quest destinations remain owned by quest state
and can re-register with the navigation service after loading.

The atlas uses `+X = east`, `-Z = north`, and north-zero clockwise bearings. Map clicks are
converted through tested bidirectional atlas helpers. The compass builds a local unwrapped
five-degree tick window around camera yaw, which preserves continuous motion through the
359°/000° seam. Waypoint guidance always provides distance, absolute bearing, relative
bearing, map placement, and an arrival latch; nearby in-view targets also receive a
projected world marker.

Movement treats player position as feet rather than camera position. The controller owns
gravity, grounded state, jump velocity, crouch eye height, sprint state, stamina, and a
recovery delay. Horizontal movement continuously sweeps the circular player footprint
against circle and oriented-box colliders, resolves the earliest time of impact, slides along
rounded corners, and deterministically depenetrates invalid streamed or saved positions.
The current colliders are intentionally planar; this leaves a clean seam for obstacle height,
slopes, climbing, or vehicles without coupling those ideas to React or world generation.

## Performance contract

The initial target is an RTX 3060-class machine at 1440p/60:

- Fixed simulation: 60 Hz, with large frame deltas clamped and spiral-of-death protection.
- Resident terrain: 81 chunks in a 9×9 visual ring; decorative props are instanced per chunk.
- Far terrain: 16–64 frustum-cullable HLOD tiles, under 60,000 triangles and 200 settlement
  proxies. Standard reaches 1.84 km, Extended 12 km, and Unlimited the finite atlas horizon
  at 70 km, with reverse-depth used when the browser exposes `EXT_clip_control`.
- Gameplay queries and ambient citizens: independent 25-chunk inner rings.
- Collision broad phase: streamed 16 m spatial cells, followed by swept-circle narrow phase;
  city cost scales with nearby candidates rather than every solid in the gameplay ring.
- Atlas territory: 9,216 km²; the full map is never resident.
- Roads, settlement blocks, forest, rocks, water, ruins, and citizens use static or instanced
  meshes; no gameplay object requires an animation clip.
- Citizen matrices present once per rendered frame with fixed-step interpolation, so they
  remain smooth on 60 Hz and high-refresh displays. Performance mode reduces population
  density rather than motion cadence. Hard resident targets remain 5,000 and 2,200 visible
  citizens respectively, with no citizen shadows.
- One shadow-casting directional sun/moon key; 2K shadow map in cinematic mode. Dynamic
  weather changes palette, fog, exposure, and one shader-driven precipitation field.
- Pixel ratio capped at 1.75; performance mode forces DPR 1 and disables shadows.
- Renderer diagnostics expose FPS, active chunks, selected horizon, far tiles, far triangles,
  settlement proxies, and optical visibility to the HUD and tests. Weather remains the final
  visibility limit, with fog and storms restoring dense extinction in every profile.
- Every unloaded chunk explicitly disposes geometries and materials.

The next production hardening modules are worker-based chunk recipes, floating-origin
rebasing, shared asset reference counting, vertical capsule
collision, and authored road routing around water and grades. Their boundaries already
align with the present world, system, and feature layers.
