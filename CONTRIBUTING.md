# Contributing to Stillpoint Frontier

Stillpoint Frontier is currently focused on reusable first-person game systems.
Changes should strengthen terrain and world generation, buildings, roads, NPCs,
movement, interaction, rendering, sound, persistence, performance,
accessibility, developer tooling, or testing. Keep narrative additions small
and useful as system-level vertical slices.

## Development environment

- Use Ubuntu under WSL2 when developing on Windows.
- Keep the checkout under the Linux filesystem, such as
  `~/code/stillpoint-frontier`; do not run the project from `/mnt/c`.
- Use the Node.js version selected by `.nvmrc`.
- Install dependencies with `npm run install:ci`.
- Run the development server with `npm run dev` and playtest in Windows Chrome
  or Edge with hardware acceleration enabled.

## Engineering expectations

- Keep procedural generation deterministic and seeded.
- Preserve save compatibility or include a tested migration.
- Prefer data-driven, modular systems over one-off authored behavior.
- Preserve graphics fallbacks, quality controls, accessibility options, and
  performance budgets.
- Do not commit secrets, dependency trees, build output, caches, or browser test
  artifacts.

## Before opening a pull request

Run the relevant tests and normally include:

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run build
```

For browser, rendering, input, or interaction changes, also run the appropriate
Playwright suites:

```bash
npm run test:e2e
npm run test:visual
```

Describe deterministic-world, save-format, performance, accessibility, and
visual implications in the pull request. Attach screenshots or Playwright
artifacts when presentation changes.
