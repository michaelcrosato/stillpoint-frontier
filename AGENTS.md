# Stillpoint Frontier — Local Codex Guide

## Product direction

Stillpoint Frontier is primarily a reusable, modular foundation for future first-person
games. Prioritize robust shared systems: terrain and world generation, buildings, roads,
NPCs, movement, interaction, graphics, sound, persistence, performance, accessibility,
developer tools, and testing.

Avoid substantial narrative content for now. Small vertical slices, test locations, and
minimal gameplay are welcome when they exercise reusable systems or make the project
meaningfully playable.

## Current checkpoint

- Public project: `https://stillpoint-frontier.michaelcrosato.chatgpt.site`
- Deployed game checkpoint: v40
- Deployed source commit: `09a577127da31cab20dda3b4009d6b73ecbc06a6`
- `main` now includes local-development, dependency, input, browser-test, and CI
  hardening beyond that deployed source. v40 remains the live public checkpoint until a
  later deployment is requested.

## Environment

- Use WSL2 with Ubuntu on Windows.
- Keep the checkout under the Linux filesystem, such as `~/code/stillpoint-frontier`.
- Do not run the project from `/mnt/c/...`.
- Use Node.js 22.13.0 or newer. The included `.nvmrc` selects the tested minimum.
- Run project commands in Bash, not native PowerShell. Several scripts require Linux,
  `flock`, `curl`, and GNU `timeout`.
- Run the game server in WSL and playtest it in Windows Chrome or Edge so the real GPU and
  display refresh rate are exercised.

## Working principles

- Inspect the relevant systems and tests before editing.
- Keep world generation deterministic and seeded.
- Preserve save compatibility unless a migration or intentional reset is part of the task.
- Prefer data-driven and reusable systems over one-off authored behavior.
- Keep gameplay, rendering, persistence, navigation, cartography, and developer tooling
  modular. Do not grow a single catch-all component when a focused module is practical.
- Retain graphics fallbacks, quality controls, toggles, and performance budgets.
- Do not remove a working feature merely to simplify a new implementation.
- Do not add secrets, generated build output, dependencies, or browser test artifacts to Git.

## Commands

```bash
nvm use
npm run install:ci
npm run dev
```

Before handing off a meaningful checkpoint, run the relevant tests and normally include:

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run build
```

For browser-facing or rendering changes, also use the appropriate Playwright suites:

```bash
npm run test:e2e
npm run test:visual
```

## Deployment

The public ChatGPT Site is controlled by the Sites project and its authenticated tooling;
there is no generic local `npm deploy` command. When the Sites lifecycle is available,
deploy each verified, coherent checkpoint to the current public site as requested by the
project owner. When it is unavailable, commit the work locally and report the exact commit
so it can be imported and deployed from the managed project chat.

Never put deployment credentials in the repository.
