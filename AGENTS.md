# Working on Stillpoint Frontier

## Read first

- README.md: setup, controls, repository map, and release commands.
- docs/ARCHITECTURE.md: ownership and performance contracts.
- docs/TESTING.md: automated checks and GPU acceptance.
- docs/AUDIT.md: recent fixes, known limits, and refactor priorities.
- docs/DEPENDENCIES.md: dependency policy, overrides, and open advisories.
- docs/audits/: dated audit reports and the decisions taken on each finding.

## Product and source rules

Three.js is the canonical engine. Preserve the existing world and survey saves.
Keep code modular, deterministic, and testable. Prefer confirmed fixes and measured
improvements over broad rewrites. Do not add story content unless requested.
Use short, clear language.

- Pure gameplay rules belong in lib/game/gameplay/.
- Install simulation behavior through core/FeatureRegistry and systems/.
- Engine composes systems and owns lifecycle. Avoid unrelated algorithms there.
- Render camera state must not replace player position or gameplay aim.
- World recipes derive from stable seed, coordinates, and feature namespace.
- Render-only detail must not expand collision, interaction, or AI residency.
- Each GPU resource needs an owner and a disposal path.
- Use ui/dialogFocus.ts for modal keyboard boundaries.

## State safety

- Keep inventory grants and resource removal atomic.
- Emit progression events only for changes that happened.
- Batch notifications from one inventory transfer before reconciling evidence;
  reconcile unrelated player actions individually to preserve objective ordering.
- Rest timestamps do not prove duration. Credit actual rest minutes.
- Normalize saves. Reject unknown or inherited catalog keys.
- Use world/heightBounds.ts for player and placement heights. The canyon has
  dry ground below −600 m.
- Display settings must write only preferences, not survey progress.
- Use gameplay/crafting.ts availability rules in both controls and transactions.
- Developer quick-start must never write the survey slot.
- Preferences are separate from survey state and remain shared.
- Failed writes must not hide readable previous saves.
- Add migrations and tests before changing the save schema.

## Verification and releases

Use locked dependencies. Do not upgrade packages as incidental cleanup.
Run typecheck, lint, coverage, production build, and test:rendered before release.
Two unit workers are the default; use --maxWorkers=1 on constrained machines.
Do not raise test timeouts to hide a regression.

WebGL acceptance needs a real browser/GPU. State what was and was not tested.
Do not claim measured FPS gains from source review alone.

Use the current Sites workflow and existing .openai/hosting.json project ID.
The owner wants completed, verified game changes published publicly. Follow
platform permissions and stop if an approval or access check blocks publishing.
Do not publish unrelated concurrent changes. Keep credentials, saves, generated
output, dependencies, and caches out of Git.
