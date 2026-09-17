# Repository audit — 2026-09-16 UTC

## Scope and evidence

This review starts from public version 44, commit
`1229f61c49cdc369b8677a55693e6cf1e5442901`. It covers dependency security, the
merge and CI pipeline, GPU and subsystem lifetimes, gameplay rule placement,
persistence, test integrity, the coverage gate, and documentation accuracy.

Evidence came from source review, the GitHub Actions and branch-protection APIs,
`npm audit` against the committed lockfile, and a full gate run — type check,
lint, coverage, production build and rendered Worker HTML — executed on Linux to
match CI. Three independent read-only reviews covered code quality, the test
suite and documentation alongside the main review. Several of their findings were
checked and discarded; those are recorded below so they are not re-investigated.

This is not a browser playthrough, a GPU acceptance pass, or a penetration test.
No FPS or VRAM figure is claimed. The public page was fetched only to read
response headers.

## Confirmed fixes

| Area | Defect | Change and evidence |
| --- | --- | --- |
| Merge pipeline | Branch protection required `Analyze (actions)` and `Analyze (javascript-typescript)`. Those names come from CodeQL advanced setup; this repository has only ever had `ci.yml` and uses default setup, which emits one `CodeQL` check. With `enforce_admins` on, no pull request could merge. Nothing had landed on `main` for ten days while three green Dependabot pull requests waited, including the fix for two critical advisories. | The two unsatisfiable contexts were removed. `CodeQL` was deliberately not added in their place: default setup reports `NEUTRAL` on Dependabot pull requests, which would recreate the deadlock. CodeQL still runs and still reports to the Security tab. |
| Dependency security | `npm audit` reported eight advisories: one critical, five high, two moderate. | Zero. next 16.3.4 closes both criticals; @cloudflare/vite-plugin 1.54.11 brings miniflare and wrangler forward so sharp resolves to 0.35.4; browserslist, baseline-browser-mapping and fflate move inside their existing ranges. See [DEPENDENCIES.md](../DEPENDENCIES.md). |
| Dependency overrides | `overrides.next.sharp` pinned sharp to exactly 0.35.2 — below the libheif fix and below next 16.3.4's own `^0.35.4` floor. That pin is why the automated sharp security update failed. The paired postcss override duplicated next's own pin. | Both removed. The `@esbuild-kit/core-utils` override stays and is now documented: that package declares `esbuild ~0.18.20`. |
| CI coverage | CI ran no dependency audit, and `.npmrc` sets `audit=false`. Dependabot alerts were the only signal, and nothing could merge to act on them. | `npm run audit:ci` runs ahead of the static gates and fails on any high or critical advisory. |
| Engine lifetime | `GameShell` assigns `engineRef` only after the constructor returns, so a throw during subsystem construction stranded the renderer, both composers, their render targets, the PMREM generator, GTAO's targets and InputManager's nine window listeners with no owner and no disposal path. The listener closures also kept the half-built Engine reachable, so it was never collected, and retries accumulated across remounts. | A constructor that throws cannot be cleaned up by its caller, so it now cleans up after itself and rethrows. `dispose()` shares that teardown and guards the fields a partial construction may not reach. |
| Reflection lifetime | `EnvironmentMapRuntime.setEnabled(false)` cleared `scene.environment` but left the PMREM target allocated, and `present()` early-returns while disabled, so nothing released it before `dispose()`. | Freed on disable, recaptured on re-enable. |
| Placement rules | `placeInventoryItem` held 105 lines of pure gameplay rules in the composition root. The archetype-to-radius table was written out twice, so editing one copy would desynchronize the reserved footprint from the overlap test. Placement validated height with `Number.isFinite` while the save normalizer rejects anything outside the supported world height range, so an out-of-range deployment was accepted in-session and silently dropped on reload, losing the item with no notice. | Rules moved to `lib/game/gameplay/deploymentPlacement.ts` with one frozen radius table and `isSupportedWorldHeight`. `MAX_PLACED_ENTITIES` replaces the bare `64` in both the Engine and the save normalizer. The rules now have a unit test and join the enforced coverage list. |
| Save schema | `CURRENT_SAVE_VERSION` drove three comparisons while the literal `8` was hardcoded in the type and three write positions. Bumping the constant alone compiled clean and wrote stale-version payloads that the guard treated as current. | All four derive from the constant; a bump is now one line the compiler enforces. |
| Test integrity | `random.test.ts` compared `hashString` to itself. That hash is the FNV-1a root of every seeded world recipe, so changing it regenerates the world while the suite stayed green. `terrain.test.ts` sampled one point twice under a name promising seam continuity. `developer-environment.test.ts` asserted that 815 equals 815. | The hash is pinned to `261_792_633`. The seam test now approaches the boundary from both sides. The tautology is gone. |
| Test flake | `chunk-residency.test.ts` builds the 81-chunk neighborhood four times against Vitest's 5 s default and timed out at 5065 ms in CI, blocking a security update. | An explicit 20 s budget, matching the four comparable tests in `world-colliders.test.ts`. The test is synchronous and deterministic, so this is not masking a regression. |
| Worker surface | `/_vinext/image` was publicly reachable, but nothing imports `next/image` and no `IMAGES` binding is declared anywhere, so the route could only dereference an undefined binding. Both cleared Next criticals concern image optimization. | Route and binding removed. |
| Response headers | Production served no `X-Content-Type-Options`, `Referrer-Policy` or `Permissions-Policy`. | All three applied to documents the Worker renders. |
| Error handling | `app/error.tsx` and `app/global-error.tsx` were absent and there is no class boundary, so a throw during render in any panel unmounted the tree to a blank page. `GameShell` handles engine failures through its own state, which cannot catch a render-time throw. | Both boundaries added, reusing the existing `.error-screen` styling. |
| Lint scope | `eslint.config.mjs` inherited `build/**` from eslint-config-next, where `build/` is output. Here it holds `build/sites-vite-plugin.ts`, real source that runs in the build pipeline and was never linted. | No longer ignored. The file was already clean. |
| Payload | `og.png` was 1.90 MB — 4.5 times the entire gzipped application bundle, and the whole of `public/`. | Re-encoded at the same 1731 x 909 as JPEG q88: 186 KB, a 90% reduction at 0.9% RMSE. |
| Dead code | Seven exports had exactly one reference repo-wide, their own declaration. `EnvironmentalAudio` kept three filter-node references that were assigned and nulled but never read. | Removed. The filter nodes stay in the audio graph; only the dead fields go. |
| Coverage scope | The enforced gate measured 51.0% of the source lines under `app/`, `lib/` and `components/`, reported as if it described the codebase. `ChunkManager.ts` was excluded although `chunk-residency.test.ts` exercises it in the node environment. | Eight modules added to the include list, taking the gate to 64.1% with all four thresholds still met: 93.28% statements, 84.55% branches, 93.51% functions, 95.16% lines. |
| Documentation | README called `worker/` optional scaffolding when it is the Worker entry point, and its map omitted eight directories. TESTING.md documented a Playwright install that populates the wrong cache under `sites-env.sh`, misdescribed the CI gate and the visual scripts, and stated a fixed 60,000-triangle horizon budget where the test asserts the per-detail-level budget. AUDIT.md reported measured coverage as enforced. DEPENDENCIES.md claimed resolved versions that were never installed, carried findings against `image-size` which is absent from the lockfile, and stated that no override was used while `package.json` carried three. | All corrected; DEPENDENCIES.md rewritten against the current lockfile. |

## Findings investigated and dismissed

Recorded so they are not re-opened:

- **`PlayerFlashlight` does free its spotlight shadow map.** Three's `SpotLight`
  overrides the no-op `Light.dispose()` and calls `shadow.dispose()`
  (three@0.185.1, `src/lights/SpotLight.js`). A sub-review reported this as a
  confirmed leak; it is not.
- **`EffectComposer.reset()` disposes both previous targets**, so
  `RenderPipeline.setQuality` and `handleContextRestored` do not leak.
- **`WorldMaterialLibrary` not calling `material.dispose()` is by design.**
  Disposal lives one layer up in `ChunkManager.disposeObjectTree`, which dedups
  geometries and skips shared materials so unloading one chunk cannot destroy
  another chunk's material.
- **The game loads no image textures at all** — every material is procedural — so
  the absence of texture disposal in `disposeObjectTree` is not a gap.
- **None of the eight advisories were reachable in production.** The built Worker
  bundle contains no sharp, fflate or image-optimizer code, and the Windows-RCE
  advisory needs a Windows-hosted Next server while production is a Linux V8
  isolate. They were fixed because they were fixable, not because they were live.

## Verification

Type check, lint, coverage, the production build and the rendered Worker HTML
contract all pass on Linux. 512 unit tests across 96 files pass. Coverage of the
included list is 96.69% lines, 94.66% statements, 96.33% functions and 86.86%
branches, against enforced thresholds of 88/88/88/82. `npm audit` reports 0
vulnerabilities.

The world seed, save schema, authored world, camera behaviour and simulation ring
sizes are unchanged. No test timeout was raised to conceal a failure, and no
dependency was upgraded as incidental cleanup — every version change closes a
specific advisory or unblocks one that does.

## Known limits

- **The coverage gate measures about two thirds of the source.** Eight modules
  joined the include list in this pass, taking it from 51.0% to 64.1% of the
  source lines under `app/`, `lib/` and `components/` with every threshold still
  green. `Engine.ts`, `HorizonRenderer.ts`, `RenderPipeline.ts` and every React
  component remain outside it. Thresholds are aggregate rather than per file, so
  an included file can sit well below the bar, and `world/targets.ts` now sits in
  the gate at 0%.
- **There is no visual regression gate.** No baselines are committed and
  `visual-chromium` runs in no CI job. Without `VISUAL_BASELINES=1` the four
  `@visual` tests assert only that a screenshot is non-blank.
- **`fast-check` runs unseeded**, so the property tests explore a different input
  space on each run. Failures print a reproducing seed, but the suite is not
  itself reproducible run to run.
- **No Content-Security-Policy or frame-ancestors policy.** The RSC payload
  arrives in inline script tags, so a useful CSP needs per-response nonces. The
  framing decision is recorded at the constant in `worker/index.ts`: whether the
  hosting platform frames the site for previews is undocumented, and breaking a
  live preview is a worse outcome than clickjacking a game that has no
  authenticated or server-authoritative action.
- **Three e2e tests settle with a bare `waitForTimeout(80)`** after teleports and
  then assert hard equalities. The same file uses `expect.poll` correctly about a
  dozen times; these three remain a wall-clock race on a contended runner.
- **Audit baseline commits are dangling.** The commits cited by the 2026-09-05
  reports are absent from history, which was squashed at `1229f61`. This report
  cites a commit that is present.
