# Stillpoint Frontier

[![CI](https://github.com/michaelcrosato/stillpoint-frontier/actions/workflows/ci.yml/badge.svg)](https://github.com/michaelcrosato/stillpoint-frontier/actions/workflows/ci.yml)

**[Play the current public build](https://stillpoint-frontier.michaelcrosato.chatgpt.site)**

![Stillpoint Frontier](public/og.png)

A low-animation, first-person Three.js open-world foundation running on
[vinext](https://github.com/cloudflare/vinext). It streams a deterministic 96×96 km
territory with biome geography, settlements and roads, gathering, movement, persistence,
aspect-correct zoomable map/compass navigation, an accelerated day/night clock, seeded biome weather, an instanced
ambient-citizen engine, continuous swept collision, and a GPU-aware test harness. The opening
vertical slice adds field contracts, crafting and deployable gear, a scanner/field guide,
deterministic loot containers, rest and camping, data-driven interior dressing, one authored
field coordinator, and rigid reactive wildlife. A temporary all-location fast-travel index
supports playtesting. Crownspire and Sunscar Canyon provide large-scale terrain landmarks,
rim/summit routes, persistent landmark water, and village gateway hubs without adding quest
narrative. Ambient citizens remain deterministic road-and-settlement bustle rather
than dialogue NPCs: no rigs, colliders, interactions, or saves.
The title screen also exposes an isolated developer quick start: a fresh noon/clear/frozen
world with invincibility, 20× traversal, and fly/no-clip that cannot overwrite the normal survey save.

## Prerequisites

- Node.js `>=22.13.0`
- Linux with `flock`, `curl`, and GNU `timeout`
- On Windows, WSL2 with Ubuntu and a checkout under the Linux filesystem

## Local development and play

On Windows, run the project inside Ubuntu/WSL2 and keep the checkout under
`~/code`; do not run it from `/mnt/c`. Use Windows Chrome or Edge for playtesting
so the game exercises the real GPU and display refresh rate.

```bash
mkdir -p ~/code
git clone https://github.com/michaelcrosato/stillpoint-frontier.git ~/code/stillpoint-frontier
cd ~/code/stillpoint-frontier
nvm install
nvm use
npm run install:ci
npm run dev
```

Open `http://localhost:5173`. The title screen offers the normal survey and an
isolated developer quick start. Default controls include WASD movement, mouse
look, Shift sprint, Ctrl crouch, Space jump, E interact, F harvest, G scanner,
L flashlight, M map, I inventory, J field guide, and Esc pause. Controls can be
rebound from Settings.

For a production-style local run:

```bash
npm run build
npm run start
```

Then open `http://localhost:3000`.

## Verification

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run build
```

Install Playwright's browser once before running the browser suites:

```bash
npx playwright install --with-deps chromium
npm run test:e2e
npm run test:visual
```

See [Testing and visual QA](docs/TESTING.md) for the deterministic browser mode,
GPU checks, and performance acceptance guidance.

## Sites Lifecycle

The Sites lifecycle CLI runs the locked dependency install before returning its managed checkout.
Application UI lives under `app/` and `components/`; reusable game systems live under
`lib/game/`. The remote Sites builder runs `npm run build` against the pushed commit.

This starter does not use `wrangler.jsonc`.

`install:ci` is intentionally a single, non-retrying `npm ci`. It refuses a concurrent install for the same project, consumes a matching image-seeded npm cache with `--prefer-offline` while retaining registry fallback for a missing cache object, otherwise downloads and verifies the complete vinext tarball recorded in `package-lock.json`, limits npm to one socket, and terminates a stalled install. `build` applies a short timeout. These helpers target Linux and use GNU `timeout`; they are not native macOS scripts.

Scripts that need writable project-scoped home, npm, XDG, and temporary paths use `scripts/sites-env.sh`. The `dev` and `start` scripts honor the caller's runtime environment and keep Wrangler logs inside the checkout. The generated `.sites-runtime/` directory is disposable and ignored by Git.

## Included Shape

- edit site code under `app/`
- `app/chatgpt-auth.ts` provides optional dispatch-owned ChatGPT sign-in helpers
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/index.ts` reads the D1 binding from the Cloudflare Worker environment
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

OpenAI workspace sites can read the current user's email from
`oai-authenticated-user-email`.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Diagnostic Commands

- `npm run install:ci`: perform the one bounded lockfile install
- `npm run dev`: start the Vite/Vinext development server
- `npm run build`: build the deployable Sites artifact
- `npm run start`: start the built Vinext application
- `npm test`: build and verify the rendered development-preview metadata
- `npm run db:generate`: generate Drizzle migrations after schema changes

Use build commands for targeted diagnosis after a remote failure, not as part of the normal checkpoint path.

The timeout defaults can be overridden for a controlled canary with `SITES_INSTALL_TIMEOUT`, `SITES_INSTALL_KILL_AFTER`, `SITES_BUILD_TIMEOUT`, and `SITES_BUILD_KILL_AFTER`. A timeout fails the command; the helpers never retry an unchanged install or build.

## Learn More

- [Architecture](docs/ARCHITECTURE.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)

## License

Copyright © 2026 Michael Crosato. All rights reserved. This public repository is
currently published without an open-source license; see [LICENSE](LICENSE).
