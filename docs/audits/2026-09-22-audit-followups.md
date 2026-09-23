# Audit follow-ups — 2026-09-22

Follows the [2026-09-16 remediation report](2026-09-16-remediation.md) and the
[2026-09-17 rendering engine audit](2026-09-17-rendering-engine.md). See
[the current audit](../AUDIT.md) for the combined release.

## Scope and evidence

This pass acted on every open finding from those two reports and from the lighting,
materials, code-quality, test and documentation reviews run with them. Each finding
was fixed test-first or given a reasoned decision below. The work landed in four pull
requests:

- #18: lighting correctness and the cached sun shadow.
- #19: the material system, shared chunk assets and a collision fix.
- #20: atmosphere, grounding shadows and adaptive resolution.
- The hygiene pull request that carries this record.

Visual changes were checked on real hardware: an RTX 4070 SUPER through ANGLE/D3D11
with reversed depth, in Chrome, driven through the `?test=1` bridge. The checks used
throwaway diagnostic builds that are never committed.

- **Counts:** draw calls, triangles, programs, shadow renders and mean frame luminance
  (0–255) were read from those builds.
- **CPU render times:** medians from interleaved A/B runs on a host shared with other
  work.
- **Not claimed:** any FPS or GPU-time figure.

## Changes

| Finding | Source | Change | Evidence |
| --- | --- | --- | --- |
| Sun elevation stepped by whole minutes | lighting F11 | `sampleDaylight` uses continuous time for elevation, daylight, golden hour and night. Clock fields stay whole minutes. | Continuity tests. |
| Key light popped at the sun/moon handover | lighting F10 | The sun and moon key lights crossfade. | From 18:02 to 18:26, shadows fade out, none show at 18:14, and the moon fills in without a pop. |
| Shadow-snap basis differed from `Matrix4.lookAt` near the zenith | lighting F12 | The snap basis mirrors `lookAt`, including its zenith fallback. | A test checks grid alignment on the camera's own axes. At noon, shadows sit directly below their casters. |
| Negative PCF bias under reversed depth; normal bias below a texel | lighting F4, F5 | `ShadowBias.ts` negates the depth bias for reversed-depth PCF, for the sun and the flashlight. Normal bias is half the rasterised texel (Ultra 0.0215, Cinematic 0.043). | At golden hour (17:30), there is no acne on tower walls or terrain, and the avatar's contact shadow stays attached. |
| Shadow maps kept after shadows were disabled | lighting F13 | Maps are released when a preset disables shadows. Re-enabling requests a render. | Going Ultra → Performance → Ultra renders the shadow once per change, and the shadows return. |
| Flashlight shadow variant not re-warmed | lighting F14 | When the program count has grown, one warm-up render runs with the beam in the opposite pose before the real render. | The first beam-on used to compile 22 programs: 1,884 ms at Ultra, and 216–232 ms on the first night. Every toggle now compiles none: 19 ms at night, 48 ms at Ultra. |
| Per-tick and per-frame allocations in the environment path | lighting F14 | The PMREM signature is numeric, and `getSample()` returns a cached, read-only object. | Unit tests. |
| Sun shadow re-rendered every frame | lighting F3 | `ShadowUpdatePolicy` renders only when needed. See the triggers below the table. | Shadow renders per 90 frames: idle 3, clock at real rate 12, first-person walk 6. A third-person walk renders all 90, because the avatar casts. Draws per frame: 1,165 with the shadow pass, 926 cached. A door or a harvest triggers exactly one render. |
| Global uniforms written per material | materials 6b | Ten shared uniforms serve every hook. The per-material pass runs only when wetness changes. | Unit tests. |
| Generation counter defeated the program cache | materials 6c | Program keys come from content plus a shared binding epoch. Per-material uniforms stay stable when hooks are reinstalled. | Unit tests. No shader errors at any quality level or feature toggle. |
| `dFdx`/`dFdy` inside non-uniform control flow | materials 6d | Derivatives are taken before the distance-guarded branches. | A test parses the real patched shader. |
| Per-role environment intensity and the wet boost were dead code | lighting F7 | The material library assigns the captured environment map, so both take effect. | The wet-over-dry luminance gain rose from +0.31 to +1.95. The dry frame went from 139.58 to 135.74. |
| Fresh materials and geometry per chunk | rendering audit | `ChunkAssetCache` shares identical assets across chunks. Each chunk holds a lease on what it uses. | CPU render median fell from 11.70 to 7.20 ms, and uploaded geometries from 485 to 286. An 81-chunk teleport fell from about 554–647 ms to about 500 ms. Draws and triangles are unchanged. |
| About 400 triangles per draw | rendering audit | **Not batched:** the batching gate was not met (see Deferred). | Draws per pass at Cinematic: rocks about 42, forest about 73, groundcover about 42, ruins about 15. Per-chunk culling already drops most meshes. |
| Horizon rings drawn past the fog horizon | lighting F8 | Rings whose inner edge the fog fully hides are skipped. The check uses the rendered, smoothed fog density. | Unlimited mode: fair 1,350 draws and 550,366 triangles, fog 1,278 and 434,974, rain 1,303 and 519,022. No holes appear at the fogged horizon. |
| PMREM regenerated every 30° of sun azimuth | materials 5d | The environment map rotates with the sun. Azimuth is no longer part of the capture signature. | The capture revision held at 7 over 35 game minutes while the rotation followed the sun. |
| No aerial perspective | lighting F9 | At golden hour, fog tints toward the sun, weighted by the cube of the view's alignment with it. | Kept after the GPU check: distant haze warms, and turning causes no whole-frame colour jump. |
| Sun disc added nothing to bloom | rendering audit | The sun and moon discs are drawn only in the bloom pass. The sky dome is hidden in that pass, not darkened into an occluder. | Facing the sun, mean luminance rises 0.06 and a soft halo shows. Facing away, nothing changes. |
| Animals and citizens cast no shadow | lighting §6 | Instanced blob shadows, twice the body footprint and faded with distance. Flying animals get none. | At Ironvale at noon, blobs darken 3,804 pixels around citizens' feet and brighten none. Animal blobs show in the 32–72 m fade band. |
| No adaptive resolution | rendering audit | When sustained GPU time runs over budget, resolution drops to between 0.6 and 1 of the pixel ratio. GPU time is sampled every 15th frame where timer queries exist. Adaptation is off in test mode and during benchmarks. | Unit tests only. See Not tested. |
| `loadChunk` built its tree before owning it | code-quality 2.3 | A throwing builder's partial tree is disposed and its lease released. Registration is the last step. | Injected-failure tests leave no chunk behind, release shared assets and retry the load. |
| Dead re-export barrel and type re-exports | code-quality §5 | The NPC barrel is gone, and its five live names now import from `stillpointNpcs`. `ChunkManager`'s type re-exports are gone. | Typecheck and lint pass. |
| No `object-src`, `base-uri` or `form-action` policy | repo audit | The Worker and Vercel send `object-src 'none'; base-uri 'self'; form-action 'self'`. | The rendered-HTML test pins both configs. Under `vinext start`, the game boots with no policy violations. |
| Coverage aggregate-only; `world/targets.ts` at 0%; big modules outside the gate; no terrain goldens; fast-check unseeded | test audit | Each file must clear a floor. The gate grew to 106 files. Nine terrain goldens were added. fast-check runs from a fixed seed, with an `FC_SEED` override. | Aggregate 94.27/84.83/95.29/96.19 (statements, branches, functions, lines). Floor 65/50/50/65, proven by failing at 51% branches. Only the type-only `targets.ts` left the gate: it has no statements, so coverage reports it as 0%. |
| README, AGENTS.md, TESTING.md and AUDIT.md gaps | docs audit | The README gained the quality key and the full map keys. AGENTS.md's read-first list gained the dependency and audit docs. TESTING.md now credits version 43 for the canyon round trip and describes the goldens. AUDIT.md now gives the save cap locations. | This record. |

`ShadowUpdatePolicy` renders the sun shadow when:

- the light direction turns more than 0.0005 rad;
- the player moves more than 1 m;
- a world change is reported;
- 30 evaluations pass without a render (a safety refresh).

## Found along the way

| Defect | Change | Evidence |
| --- | --- | --- |
| The collision index missed colliders that a long slide reaches | `querySweep` now queries the region a slide can carry the player into | fast-check found it with seed 1186013471: a 22.8 m move slid 13 m into a collider the query had dropped. The case is pinned as a regression test. |
| Shared chunk assets were never released | Leases dispose an asset when the last chunk using it unloads | The CI churn test's geometry count is bounded again. |
| The darkened sky dome hid the celestial discs from bloom | The dome is marked `hideInBloom` | Luminance with the discs on and off was identical before the fix. |
| A blob the size of the body footprint hid under the body | Blobs are twice the footprint | The shader holds a blob above half strength only within about half its radius. |

## Not changed

| Finding | Source | Decision |
| --- | --- | --- |
| Tone mapping is ACESFilmic | rendering audit | An art decision, not a defect. The golden-hour look is deliberate, and a custom grade sits on top. |
| No visual regression gate | test audit | Crowd and wildlife presentation advance with wall time even in manual render mode. Screenshots are therefore not deterministic, and a pixel gate would flake. It needs a presentation-freeze hook first. |
| CSP `script-src` and `frame-ancestors` | repo audit | The inline RSC payload would need per-response nonces, and platform framing is undocumented. The directives added above are the ones that cannot break anything. |
| Log depth could be gated on horizon mode | materials 5e | Log depth is a `WebGLRenderer` constructor option. Gating it would mean recreating the renderer on a settings change, and only for hardware without `EXT_clip_control`. |
| Vegetation shadows do not sway | materials §4 | Swaying shadows would force a shadow render every frame, which would undo the shadow cache. The cache is worth far more. |
| Point-light count changes recompile programs | materials 6f | Each count compiles once while a material holding it lives, and the persistent shared materials keep those variants alive. A fixed light pool would add a permanent per-fragment cost. |
| Extra shadow render on the post-processing failure path | lighting §7 | It is one frame on an error path, after which the pipeline stays on the direct path. |
| Sun shadow box anchored on the player | lighting F2 | Checked on the GPU: the isometric view at 96 m showed no box edge. Every camera preset frames the player, so re-centring could lose foreground shadow. |
| Per-mesh material clones in authored buildings | materials 6g | Only three buildings use them. Container appearance changes emissive under container roots, so shared templates could light walls along with containers. |
| `track()` snapshots materials once | materials 6h | Documented on `track()`; not changed. |
| Redundant exports (18 values, about 97 types) | code-quality §5 | No runtime effect: tree-shaking already drops them. The dead barrel above was removed. |
| Extracting `emitSnapshot`, `installTestBridge` and `syncContractNavigation` | code-quality §3 | These are structural refactors with no user-visible effect. AGENTS.md prefers measured changes. |
| Three `waitForTimeout(80)` calls in the chunk-churn e2e | test audit | They cost about one second of CI. The test counts lazily warmed geometry, so the waits may matter. |
| `chatgpt-auth.ts`, `db/` and `examples/d1/` scaffolding; `installTestBridge` in the bundle | repo audit | The intent is documented, and the e2e suite depends on the bridge. |

## Deferred, measured opportunities

- **Tree batching:** about 73 forest draws per pass at Cinematic. It needs a batching
  path in the wind shader and a refactor of instanced harvest targets.
- **Third-person shadow:** the sun shadow renders every frame in third person, because
  the avatar casts. Drawing the avatar into its own small map would restore caching there.
- **Shadow-grid rotation:** the texel snap stabilises translation, not rotation. Each
  direction update re-rasterises shadow edges on a slightly rotated grid.
- **Aerial perspective:** the sunward haze is one fog colour per frame, not a per-pixel
  scattering term.
- **Disc glow and clouds:** the discs dim with cloud cover, but clouds the sky draws do
  not occlude them individually.
- **Blob capacity:** blobs are capped at 512 citizens within 56 m. In a denser crowd,
  the farthest get none.
- **Coverage:** the per-file floor sits at the weakest file, so raise it as those files
  gain tests. Engine.ts, RenderPipeline.ts and EnvironmentMapRuntime.ts still rely on
  Playwright.

## Verification

- **#18–#20:** each passed the quality gate, both browser gates, CodeQL and the Vercel
  preview before merging.
- **Hygiene pull request:** typecheck, lint, coverage, build and the rendered-Worker
  contract pass in a Linux clone. The unit suite has 637 tests in 108 files.
- **Code review:** automated review was unavailable for #18–#20 because of usage
  limits.

## Not tested

- FPS and GPU frame times.
- Adaptive resolution end to end. Test mode disables it, and outside test mode the
  automation tab has no bridge and no frame loop.
- Live rain accumulation. Wetness was forced through the material library instead.
