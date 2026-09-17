# Rendering engine audit — 2026-09-17 UTC

## Scope and evidence

A top-to-bottom review of the render path: `lib/game/rendering/` (pipeline,
post-processing, materials, PMREM, GPU timing), the lighting and atmosphere in
`lib/game/environment.ts`, shadow configuration, and the HLOD horizon renderer.
Baseline was commit `144745a`.

Unlike the previous audits, this one was measured on hardware. The production
build was served locally and driven through the engine's own `?test=1` bridge in
Chrome on an **NVIDIA RTX 4070 SUPER** (ANGLE / D3D11, WebGL2, `EXT_clip_control`
present so the reversed-depth path is active, `maxSamples` 8). Draw-call and
triangle figures are `renderer.info` counters. CPU figures are medians of 41
`renderOnce()` samples with non-overlapping quartiles.

Two independent read-only reviews covered materials/shading and
lighting/shadows. Several of their findings were checked and corrected; those
corrections are recorded below so they are not re-litigated.

**Not covered:** GPU-side timing. The engine's GPU timer needs a foregrounded
`requestAnimationFrame` loop, and an automated tab is throttled, so no fragment
or GPU-time claim appears anywhere in this report. Interior lighting was not
audited.

## The governing measurement

The frame is **submission-bound, not GPU-bound**.

| Preset | draw calls | triangles |
| --- | --- | --- |
| performance (no shadows, no post) | 622 | 237,800 |
| cinematic | 1,189 | 479,504 |
| ultra (+ GTAO) | 1,288 | 521,726 |

About 400 triangles per draw call. Two consequences follow:

- **World detail scales triangles but not draw calls.** Levels 0 → 4 move
  triangles 423,390 → 753,102 (+78%) while draw calls stay flat at ~1,200. The
  main quality lever players have does not touch the dominant cost.
- **Shadows roughly double draw calls** (622 → 1,189): one directional caster
  re-traversing the scene.

This is why the remediation reduces per-frame cost rather than adding effects.
Adding SSR, TAA, motion blur, depth of field or volumetrics to this frame would
make it measurably worse.

## Root cause of the draw-call count

`ChunkManager` alone has 17 material-instantiation sites executed **per chunk**.
With 81 resident chunks that is hundreds of distinct `MeshStandardMaterial`
instances for a handful of surface types, and Three cannot batch across distinct
materials. `sharedMaterials` contains exactly one entry, the water surface.

`WorldMaterialLibrary` is most of the way to a fix already: it reference-counts
materials (`retainMaterial` / `releaseMaterial`) and every tracked material
carries a `userData` role descriptor. It *tracks* materials rather than
*providing* them. An `acquire(role)` returning a shared instance would let the
existing refcounting own lifetime. `WEBGL_multi_draw` is present on test
hardware, so `BatchedMesh` becomes viable afterwards — genuinely applicable to
vegetation, where 12 woody and 7 groundcover geometries share one material
shape. Order matters: cache geometry and material by kind first, then batch.

## Confirmed fixes

| Area | Defect | Change and evidence |
| --- | --- | --- |
| Bloom cost | Selective bloom walked the whole scene graph twice per frame: once to swap every non-bloom mesh to the black occluder, once more to restore. The restore walk visited every object in the graph to find the handful it had touched. | Restores by iterating the two collections the darken pass already records, and darkens with `traverseVisible`, since an invisible subtree is not drawn. Bloom's CPU cost at ultra fell from **3.3 ms to 2.0 ms** per frame. Control: the no-bloom path was unchanged (3.8 → 4.0 ms, noise) and draw calls and triangles were identical. |
| Transmission | Any material with `transmission > 0` makes Three re-render the opaque scene into a separate target sized by `transmissionResolutionScale`, which defaults to 1.0 and was never set. The only transmissive materials are window panes on three authored buildings, one of which is the spawn compound. | `transmissionResolutionScale = 0.5`, quartering that pass. Imperceptible through 4 cm panes at transmission 0.72. |
| Shading | Five materials set `vertexColors: true` on geometry with no `color` attribute. | Removed. See the correction below for why this was a latent landmine rather than a visible bug. |
| Shadow softness | Three 0.185 removed `PCFSoftShadowMap`, leaving `shadow.radius` as the only control for the 5-tap Vogel PCF kernel. The flashlight already set 2; the sun was at the default 1, the hardest available. | `sun.shadow.radius = 2.5`. Verified in-game: the tree shadow reads soft rather than mushy. |
| Shader hooks | `ProceduralSurfaceDetail` and `VegetationWind` patch Three's shaders with `String.replace`, which no-ops on a missed match. A chunk rename upstream would break them silently and *partially* — `SURFACE_DETAIL_ROUGHNESS` uses identifiers `SURFACE_DETAIL_COLOR` declares, so a half-applied patch fails to link. The existing tests fed hand-written shader strings and would pass regardless of what Three ships. | `tests/unit/shader-patch-anchors.test.ts` asserts Three still ships every chunk the installers patch against, and that the real installers injecting over `THREE.ShaderLib.physical` actually changes it. Validated by mutation: renaming `roughnessmap_fragment` in the loaded bundle makes it fail. |

## Corrections to sub-review findings

- **The `vertexColors` materials are not rendering black.** The mechanism was
  reported correctly — an enabled-but-unbound vertex attribute reads
  `(0, 0, 0, 1)`, so `vColor.rgb *= color` zeroes the albedo, and I confirmed on
  the test GPU that such an attribute renders pure black. But the conclusion was
  wrong. `ShaderMaterial.defaultAttributeValues` sets the *global* generic
  `color` attribute to `[1, 1, 1]`, and that value persists across later draws;
  the sky is a `ShaderMaterial` at `renderOrder -3`, so it runs first and leaves
  the attribute white. Correctness depended on draw order and on the linker
  assigning `color` the same location in unrelated programs. Removing
  `vertexColors` removes the dependency with no visual change — `setColorAt`
  works through `USE_INSTANCING_COLOR` independently.
- **The "320 lights over 8 draws" figure in the docs is accurate.** It refers to
  320 emissive `Points` vertices in at most 8 draws, contributing no
  illumination, exactly as `docs/ARCHITECTURE.md` goes on to say.
- **Cascaded shadow maps are not justified.** The single cascade is 176 m at
  4.3 cm per texel on ultra, already at or better than a typical first cascade,
  and clear-weather visibility computes to roughly 618 m rather than kilometres.

## What is already modern

Recorded so it is not "fixed" later:

- **Reversed-Z depth buffer** with a logarithmic fallback, confirmed active on
  test hardware.
- **Correct HDR chain.** `render → GTAO → bloom → grade → OutputPass`: every
  effect operates in linear HDR and tone mapping is applied exactly once, last.
- MSAA through render-target samples, quality-scaled; GTAO correctly disabled
  under logarithmic depth, which cannot support its depth reconstruction.
- Post-processing failure falls back to a direct render rather than breaking the
  session, restoring renderer state first.
- Triplanar procedural surface detail with explicit footprint-based
  anti-aliasing and 256 m-wrapped world position to bound float precision.
- Vegetation wind bakes a root-to-crown weight attribute and expands bounding
  volumes so swaying geometry is not culled early.
- `compileAsync` was evaluated and declined, with the lifecycle reason recorded
  at the call site.

## Known limits

- **Draw-call reduction is unstarted.** The shared-material work described above
  is the highest-value remaining item and was not attempted here.
- **Animals and citizens never cast shadows**, at any quality, while the terrain
  under them receives. A cheap grounding shadow is the best content-justified
  visual gap in the game.
- **Per-material `envMapIntensity` is dead code.** Three force-writes
  `scene.environmentIntensity` on every draw when `material.envMap === null`, so
  the per-role environment scale and the wet-surface reflection boost have no
  effect.
- **The sun disc contributes nothing to bloom.** The sky is never marked as a
  bloom source. Marking the whole sky was tried and reverted: it blooms the
  daytime horizon band as well as the discs, and runs the cloud-heavy sky shader
  over the bloom frame in place of the black occluder. The CPU cost did not
  regress (1.6 ms against 2.0 ms) but that measures submission, not fragment
  work, which this environment cannot measure. A dedicated celestial-disc mesh
  is the correct implementation and needs GPU acceptance.
- **The sun shadow box is anchored on the player, not the camera.** At the 96 m
  camera distance roughly half the box falls behind the view.
- **Reversed-depth PCF bias sign.** Three's PCF-2D path does not negate
  `shadow.bias` under a reversed depth buffer while its VSM, BASIC and point
  paths do. This makes bias behave differently on hardware with and without
  `EXT_clip_control`. Not reproduced visually.
- **`matrixAutoUpdate` is never disabled**, so every object recomputes matrices
  each frame although chunk content never moves after placement and vegetation
  wind is vertex-shader based. A blanket change is unsafe: doors animate.
- **No adaptive resolution.** The GPU timer, quality presets and pixel-ratio
  control all exist, but GPU timing is consumed only by the developer benchmark.
- **Tone mapping is ACESFilmic.** Three 0.185 offers AgX and Neutral. The
  golden-hour look is deliberate and a custom grade pass sits on top, so this is
  an art decision rather than a defect.
