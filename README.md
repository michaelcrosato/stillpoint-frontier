# Stillpoint Frontier

A Three.js open-world game on React and Vinext. The world is a deterministic
96 × 96 km territory. Only a small area around the player is loaded in detail.

[Play the public game](https://stillpoint-frontier.michaelcrosato.chatgpt.site)

## Start here

- [Architecture and system contracts](docs/ARCHITECTURE.md)
- [Testing and hardware QA](docs/TESTING.md)
- [Latest audit, fixes, and known limits](docs/AUDIT.md)
- [Most recent remediation pass](docs/audits/2026-09-16-remediation.md)
- [Dependency security review](docs/DEPENDENCIES.md)
- [Contributor and Codex guide](AGENTS.md)

The game includes settlements, roads, terrain landmarks, gathering, contracts,
crafting, field gear, local saves, weather, and a day/night cycle. Citizens and
wildlife use rigid instanced models. Three.js is the production engine.

## Local setup

Use Node.js 22.13 or newer and Linux. On Windows, run the repo in WSL2/Ubuntu.
The install and build helpers need Bash, flock, curl, sha256sum, and GNU timeout.
Native PowerShell does not supply these commands.

```bash
npm run install:ci
npm run dev
```

Open the local URL printed by Vite, normally http://localhost:5173.
Use a browser with WebGL2. Use your local GPU for graphics acceptance checks.

The lockfile defines the dependency versions. Install once per fresh checkout or
lockfile change. Do not run concurrent installs. The install helper checks the
locked Vinext archive, uses a project-local cache, and bounds install time.
Generated runtime files and build output are not source.

## Controls

These are the default keys. Settings supports rebinding.

| Action | Control |
| --- | --- |
| Move / sprint / crouch | WASD / Shift / Ctrl or C |
| Jump | Space |
| Interact / harvest | E / F or left mouse button |
| Phone light / scanner | L / G |
| Map / inventory / field guide | M / I / J |
| Camera presets | V |
| Camera zoom | Mouse wheel during captured play |
| Pause / release pointer | Escape |
| Developer console | Backquote or DEV button |
| Quick recovery | R when incapacitated |

Explicit key bindings take priority over optional shortcuts. If you bind C to
another action, C no longer crouches.

Settings provides First Person, Third Person, and Isometric presets. Zoom is
continuous from 0 to 96 m. The elevated view uses perspective projection with
a lower field of view; it is not a true orthographic camera. Its angle ranges
from 45° to 70°. Camera obstruction retracts the view. Gameplay aim and
interaction range stay at the player, not at the displaced camera.

Map controls: scroll, use +/−, or use the slider to zoom from 1× to 32×.
Drag to pan. P centers the player. N centers the target. 0 fits the territory.
Alt + Arrow Keys pans. Arrow Keys move a waypoint; Enter places one.
Escape closes the map. Map shortcuts apply when the map plot has focus.
Ctrl/Cmd combinations and modified wheel gestures remain browser controls.

Interface Scale provides Compact, Standard, Large, and X-Large text.
Field Operations tabs support Left/Right Arrow, Home, and End. Fabrication
shows STACK FULL when the output item has no free space.

## Survey and developer sessions

There is one browser-local survey save. It is not a cloud save. Use the same
browser profile and site origin to access it.

- Enter or Resume Survey uses the normal save.
- Start in Dev Mode always starts fresh at the Field Unit Compound.
- The dev start sets noon, clear weather, frozen time, 20× speed, flight, and
  invincibility. It cannot overwrite the survey slot.
- Loading the survey exits the isolated dev session.
- Enabling developer tools inside a normal survey does not isolate that survey.
- Developer movement offers Normal, 5×, and 20×. Space ascends in flight;
  Ctrl or C descends unless rebound; Shift boosts.
- Interface, camera, sound, quality, and key preferences are shared across sessions.
  Changing the horizon or resetting settings writes only the preferences slot.

Survey state saves on relevant actions, every 30 seconds after launch, when the
tab is hidden, and on orderly engine disposal. A browser crash or forced close
can lose changes since the last successful write. A failed write does not delete
a readable older save.
Player and camp saves support dry Sunscar Canyon ground below sea level. Both
use the same validated height range, from −1,000 to 5,000 m.

## Repository map

| Location | Responsibility |
| --- | --- |
| app/ | Page, metadata, global styles |
| components/ | HUD, map, dialogs, settings, developer tools |
| lib/game/Engine.ts | Runtime composition, launch, lifecycle, snapshots |
| lib/game/core/ and systems/ | Feature registry, fixed-step systems, movement |
| lib/game/camera/ and input/ | Render camera, avatar, key and mouse input |
| lib/game/world/ | Terrain, authored locations, chunks, roads, horizon |
| lib/game/rendering/ | GPU pipeline, materials, effects, timing |
| lib/game/gameplay/ | Pure inventory, contracts, loot, crafting, rest |
| lib/game/persistence/ and session/ | Versioned saves, preferences, launch policy |
| lib/game/navigation/ and cartography/ | Waypoints, compass, map viewport |
| lib/game/npcs/, citizens/, animals/ | Authored and ambient population |
| lib/game/audio/ and equipment/ | Environmental audio, player gear |
| lib/game/ui/ | Modal keyboard boundaries |
| lib/game/developer/ | Developer sandbox, benchmark, stress tests |
| worker/ | Cloudflare Worker entry point that serves the game |
| build/ | Vite plugin that packages Sites metadata into dist/ |
| public/ | Favicon, social preview image, static art |
| db/, drizzle/, examples/d1/ | Optional D1 scaffolding, unused by the game |
| tests/unit/ | Deterministic logic and non-browser integration tests |
| tests/e2e/ | Browser and hardware-facing scenarios |
| scripts/ | Bounded Linux install, environment, and build helpers |

worker/index.ts is live: vite.config.ts names it as the Worker entry and the
build emits it to dist/server. Optional Sites auth and D1 scaffolding remains in
app/chatgpt-auth.ts, db/, and examples/d1/; none of it is wired into the game,
which requires neither sign-in nor a database. app/chatgpt-auth.ts derives
identity from proxy-supplied headers, so it is only safe behind a gateway that
strips client copies of those headers. Do not treat browser-local state as
server-authoritative data.

## Release checks

```bash
npm run typecheck
npm run lint
npm run test:coverage
npm run build
npm run test:rendered
```

Unit tests use two workers by default to limit contention during heavy chunk
construction. For a constrained machine, use
`npm run test:coverage -- --maxWorkers=1`.

`npm test` runs unit tests, the production build, and the rendered Worker HTML
contract. Browser checks are separate. See [Testing](docs/TESTING.md).

`npm run audit:ci` fails on any high or critical advisory and runs in CI ahead
of the static gates. For a manual review run `npm audit` and inspect the
affected dependency paths; development packages can still supply code to the
Worker build. The current review is in [DEPENDENCIES.md](docs/DEPENDENCIES.md).

Prefer a targeted bump over `npm audit fix --force`, which has previously
proposed a framework beta and a database-tool downgrade.

## Preview deployments

The repository is connected to Vercel, which builds every pull request. Vercel
is a preview target only; the public game is served by the Cloudflare Worker
through the Sites workflow below.

`vercel.json` pins `framework: null` so Vercel does not auto-detect Next.js and
look for a `.next` directory that `vinext build` never produces. The Vercel
build runs `npm run build:vercel`, which is the normal build plus
`scripts/prerender-static.mjs`. That script renders `/` through the built Worker
and writes `dist/client/index.html`, so the output can be served as static
files: the game is client-side and the shell carries its RSC payload inline.

Do not add the prerender to `npm run build`. A Cloudflare Worker with an assets
directory serves a matching static file before invoking the Worker, so an
`index.html` in `dist/client` would shadow the live render and bypass the
Worker response headers.

## Publishing

Reuse the existing project ID in .openai/hosting.json. Build the exact source
state, commit and push it, then package the built output. Save that version and
deploy the saved version to the existing public site. Follow the current Sites
workflow; the old lifecycle checkpoint CLI is not the release interface.

The project owner's standing preference is to publish completed, verified game
changes publicly. Do not publish failing builds or unrelated concurrent edits.
Never commit credentials, browser saves, dependencies, or generated caches.
