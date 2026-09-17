# Repository audit — 2026-09-05 UTC

> A later pass on 2026-09-16 covered dependency security, the merge pipeline,
> subsystem lifetimes, test integrity and documentation accuracy. See the
> [2026-09-16 remediation report](audits/2026-09-16-remediation.md).

## Scope and evidence

This review starts from public version 44, commit
`06078a274b5d4539de83b731f5e38a690f92898b`. Its 484 unit tests, type check,
lint, and coverage gate pass before changes. The
[version 44 report](audits/2026-09-05-version-44.md) preserves the previous audit.

The review covers runtime ownership, streaming, rendering, wildlife, movement,
camera and input, scanner and interactions, inventory and progression, saves,
preferences, UI, Worker routes, build scripts, dependencies, and documentation.
It uses source review, regression tests, production compilation, and rendered
Worker HTML. This is not a browser playthrough or penetration test. The public
page could not be fetched from the audit environment; live pixels were not inspected.

The project is a client-side Three.js game served by a React/Vinext Worker.
Deterministic recipes generate a 96 × 96 km atlas, with 81 detailed chunks and
separate 25-chunk gameplay, citizen, and wildlife rings. Pure gameplay rules feed
fixed-step systems. Engine owns lifecycle; React consumes snapshots. Survey state
uses one versioned browser-local slot, while preferences have their own slot.
There are no active application Server Actions, upload routes, or database bindings.

## Confirmed fixes

| Area | Defect or excess work | Change and evidence |
| --- | --- | --- |
| Wildlife culling | Every species used a sphere centered near sea level. Crownspire and Sunscar instances fell outside it and could be culled while visible. | Bounds now enclose the exact presented instance matrices. Tests cover both landmarks and the compound, relocation, time, interpolation, and quality changes with culling enabled. |
| Reflection failure | Three's PMREM error path left the renderer on an offscreen target, with changed clear, tone-mapping, or XR state. The next game frame could render incorrectly despite the existing fallback. | A finally block restores borrowed renderer state after capture and filtering. Tests inject errors through the real PMREM generator, verify state restoration, prevent same-signature retries, and retain the last successful reflection. |
| Scanner work | Every eligible subject ran terrain/collider visibility checks even when its score could not win. | Score rejection now precedes visibility checks. A 20-candidate fixture falls from 20 queries to one; occlusion fallback and tie order still pass. |
| Quality key label | The HUD always showed Q after the player rebound the quality action. | The label now uses the saved binding, like the other HUD controls. This small edit was reviewed against the existing binding helper. |
| Dependency security | React Server Components and seven indirect packages had compatible security fixes. | React, React DOM, and the RSC package are pinned to 19.2.8. Seven affected indirect packages and their required dependency trees were updated within existing ranges. npm findings fall from 23 affected packages to 15. |

Wildlife bounds add a bounded pass over at most 72 instance matrices per rendered
frame. They do not add draw calls, animals, or simulation chunks. Scanner evidence
measures query counts, not FPS. The world seed, save schema, authored world, and
camera behavior remain intact.

## Verification

Strict TypeScript, ESLint, all 491 unit tests in 95 files, the production build,
and the rendered Worker HTML contract pass. The enforced thresholds are 88%
statements, 82% branches, 88% functions and 88% lines, over the include list in
vitest.config.ts rather than the whole repository. Measured coverage of that list
exceeds each threshold; see docs/TESTING.md for the scope caveat.
Coverage percentages apply only to the explicit include list in vitest.config.ts.
The new wildlife and PMREM tests exercise Three objects without WebGL. They do
not establish GPU performance, driver behavior, or correct pixels on hardware.

The dependency audit still exits with findings: 11 high and four moderate affected
packages, with no critical findings. These are package counts, not distinct CVEs.
See [DEPENDENCIES.md](DEPENDENCIES.md) for paths, source links, and follow-up work.

## Known limits and next work

- Browser/GPU acceptance remains open. Check wildlife at both terrain extremes,
  quality rebinding, reflection toggles, startup, and context recovery on hardware.
- The remaining dependency fixes require review of the Vinext/Cloudflare/Next
  toolchain and optional database tools. The audit is not security-clean.
- One browser-local survey slot has no cloud sync or cross-tab conflict handling.
  Save version 8 reads versions 1–8 and protects newer-version data. Save caps are
  10,000 resource changes, 256 doors, 128 discoveries, 512 containers, and 64 placements.
- Camera collision uses terrain, authored supports, and height-aware prisms.
  It is not a full capsule solver. Vegetation shadows remain static.
- Chunk construction is synchronous. Measure 20× travel before changing its
  scheduling. Current tests bound registered residency, not all intermediate memory.
- The build warns about the game bundle size: about 1.10 MB minified, or 290 KB
  with local gzip compression. It includes the Three runtime and game. Profile
  network and startup work before deciding whether a new loading boundary helps.
- Mid-factory allocation failure is not fully exception-safe. The PMREM change
  restores renderer state but cannot reclaim an output target that Three allocates
  internally and never returns after a failed capture. Repeated distinct failed
  captures and WebGL context loss need hardware resource checks.
- Extract session/persistence orchestration from Engine when expanding save slots
  or launch modes. Consider floating-origin rebasing when distant travel is expanded.

## Manual acceptance

1. Travel to Crownspire and Sunscar. Turn the camera toward moving wildlife from
   several angles, then change quality and return to the compound.
2. Rebind Quality in Settings. Check that the HUD shows the new key and that the
   action still changes quality during captured play.
3. Cycle reflections, weather, quality, and camera views. Check that the world
   remains visible and that context recovery restores the renderer.
4. Scan overlapping subjects and subjects behind walls. The nearest eligible
   visible subject should win using the existing distance/alignment score.
5. Run the existing save, movement, map, and controlled hardware checks in
   [TESTING.md](TESTING.md), including matched performance captures if comparing FPS.
