# Stillpoint Frontier architecture

Stillpoint Frontier is intentionally built around static-world gameplay. There are no
skeletal rigs, animation clips, `AnimationMixer` instances, or character state machines
in the engine core. Variety comes from deterministic terrain, sightlines, discovery,
lighting, navigation, and state changes.

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
- Pure modules (`terrain`, `random`, `collision`, and `state`) contain simulation rules that
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

## Performance contract

The initial target is an RTX 3060-class machine at 1440p/60:

- Fixed simulation: 60 Hz, with large frame deltas clamped and spiral-of-death protection.
- Resident terrain: 25 chunks; decorative props are instanced per chunk.
- One shadow-casting directional light; 2K shadow map in cinematic mode.
- Pixel ratio capped at 1.75; performance mode forces DPR 1 and disables shadows.
- Renderer diagnostics expose FPS, active chunks, and triangles to both the HUD and tests.
- Every unloaded chunk explicitly disposes geometries and materials.

For a production-sized world, the next engine modules should be worker-based chunk recipes,
origin rebasing beyond roughly one kilometre, authored collision adapters, asset reference
counting, and save-schema migrations. Their boundaries already align with the present
world, system, and feature layers.
