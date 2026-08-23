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
- `ChunkManager` maintains a 5×5 resident ring, creates deterministic chunk content from
  the world seed and integer chunk coordinates, and owns every render/collision resource
  that must be disposed when a chunk leaves the ring.
- `CitizenEngine` independently streams the same resident ring. Its pure recipes place
  proportional crowds only on settlement sidewalks or road shoulders, while one shared
  low-poly figure and one instanced draw per populated chunk keep Vesper Crown's thousands
  of visible citizens within budget. Citizens never enter target, collider, dialogue, or
  persistence systems.
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
  and error interfaces. The renderer never reaches into React state.

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
derivable. Inventory and its matching entity delta are written in the same version-two
save operation, while version-one relay saves migrate in place.

Movement treats player position as feet rather than camera position. The controller owns
gravity, grounded state, jump velocity, crouch eye height, sprint state, stamina, and a
recovery delay. This leaves a clean seam for slopes, vertical colliders, climbing, or
vehicles without coupling those ideas to React or world generation.

## Performance contract

The initial target is an RTX 3060-class machine at 1440p/60:

- Fixed simulation: 60 Hz, with large frame deltas clamped and spiral-of-death protection.
- Resident terrain: 25 chunks; decorative props are instanced per chunk.
- Atlas territory: 9,216 km²; world size does not alter the 25-chunk resident budget.
- Roads, settlement blocks, forest, rocks, water, ruins, and citizens use static or instanced
  meshes; no gameplay object requires an animation clip.
- Citizen matrices present once per rendered frame with fixed-step interpolation, so they
  remain smooth on 60 Hz and high-refresh displays. Performance mode reduces population
  density rather than motion cadence. Hard resident targets remain 5,000 and 2,200 visible
  citizens respectively, with no citizen shadows.
- One shadow-casting directional light; 2K shadow map in cinematic mode.
- Pixel ratio capped at 1.75; performance mode forces DPR 1 and disables shadows.
- Renderer diagnostics expose FPS, active chunks, and triangles to both the HUD and tests.
- Every unloaded chunk explicitly disposes geometries and materials.

The next production hardening modules are worker-based chunk recipes, floating-origin
rebasing, terrain/settlement HLOD, shared asset reference counting, vertical capsule
collision, and authored road routing around water and grades. Their boundaries already
align with the present world, system, and feature layers.
