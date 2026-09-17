# Dependency security review

Reviewed on 2026-09-16 UTC against the committed lockfile with `npm audit`.
`npm audit` reports **0 vulnerabilities**. The previous review (2026-09-05) left
eight advisories outstanding; every one is now resolved by a supported version
change rather than a forced repair.

`npm run audit:ci` runs this check in CI ahead of the static gates and fails on
any high or critical advisory. Package totals below count dependency chains, not
distinct vulnerabilities.

## Applied fixes

| Package | Previous | Resolved | Why |
| --- | --- | --- | --- |
| next | 16.2.11 | 16.3.4 | Two critical advisories: [GHSA-p293-qw3h-jr36](https://github.com/advisories/GHSA-p293-qw3h-jr36) and [GHSA-2xp9-vwfh-vxw4](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4). Patched in 16.3.3. |
| @cloudflare/vite-plugin | 1.54.0 | 1.54.11 | Pulls miniflare 5.20260916.0-alpha and wrangler 4.133.0, which resolve sharp to a patched build. |
| @cloudflare/workers-types | 5.20260826.1 | 5.20260917.1 | wrangler 4.133.0 declares `peerOptional @cloudflare/workers-types ^5.20260916.1`; the install fails with ERESOLVE without this. |
| wrangler | 4.126.0 | 4.133.0 | Above the `4.16.0 - 4.130.0` advisory range and matched to the plugin. |
| sharp (indirect) | 0.35.2 | 0.35.4 | [GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c), libheif. |
| browserslist (indirect) | 4.28.2 | 4.29.0 | Two high advisories, patched in 4.28.7. |
| baseline-browser-mapping (indirect) | 2.10.30 | 2.11.24 | Patched in 2.11.0. |
| fflate (indirect) | 0.7.4 | 0.7.5 | Reached under `@shuding/opentype.js`'s own `^0.7.3` range, so no override was needed. |
| three | `^0.185.1` | `0.185.1` | Not a security change. The production engine was the only runtime dependency on a floating range. |

`sharp` could not be lifted by removing the override alone: `miniflare` pinned it
to exactly 0.35.2, so the fix had to come from the Cloudflare toolchain. The
exact changes are in package-lock.json, which is generated on Linux to match CI.

## Overrides in use

The previous revision of this document stated that no override was used. That was
incorrect. One override is load-bearing:

| Override | Reason |
| --- | --- |
| `@esbuild-kit/core-utils` → `esbuild` `0.25.12` | `@esbuild-kit/core-utils@3.3.2` declares `esbuild ~0.18.20`. The package is deprecated upstream (merged into tsx) and arrives through drizzle-kit. Removing the override reintroduces esbuild 0.18.x. |

Two overrides were removed. `next` 16.3.4 declares `sharp ^0.35.4` and
`postcss 8.5.23` itself, so the `next` override block pinned `sharp` *below* both
Next's own floor and the libheif fix while duplicating Next's postcss pin. That
pin is also why the automated `sharp` security update failed.

## Reachability notes

These remain true and are worth carrying forward, because a resolved advisory
count is not the same as an exposure assessment.

- **Production runs a built Cloudflare Worker**, a Linux V8 isolate. Advisories
  that require a Windows-hosted Next server do not describe the deployed target.
- **The image-optimization route has been removed** from `worker/index.ts`.
  Nothing imports `next/image` and no `IMAGES` binding was ever declared, so the
  route could only dereference an undefined binding. Both Next criticals above
  concern image optimization.
- **`sharp`, `browserslist`, `baseline-browser-mapping` and `fflate` are
  build- and development-time only.** None appears in the built Worker bundle.
  Development packages *can* still supply code to that bundle, so category alone
  is never sufficient — this was checked against `dist/`.
- **No D1 binding or active game database is configured** (`.openai/hosting.json`
  has `"d1": null`), so the drizzle-kit migration toolchain is not on any runtime
  path.
- **`image-size` is not installed.** A previous revision of this document
  recorded findings against it; it appears nowhere in the lockfile.

Prefer a targeted bump over `npm audit fix --force`, which has previously proposed
a framework beta and a database-tool downgrade. Those are platform changes, not
verified repairs for this project.

## Repeat the review

1. Install the committed lockfile using the repository's install helper.
2. Run `npm audit --json`; retain the date and full dependency paths during review.
3. Read the upstream advisories and check application and generated Worker paths.
4. Apply supported fixes, inspect lockfile changes, and rerun the release gates.
5. Update this report with resolved and outstanding findings. Never use package
   category alone to infer whether code ships in production.
