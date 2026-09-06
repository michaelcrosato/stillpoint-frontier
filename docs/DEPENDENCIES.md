# Dependency security review

Reviewed on 2026-09-05 UTC using the complete package lock and `npm audit --json`.
The original lock reported 23 affected packages: 17 high, five moderate, and one
low. The revised lock reports 15: 11 high and four moderate. Neither scan reported
critical findings. Package totals include dependency chains and are not counts
of distinct vulnerabilities. The remaining audit exit code is 1.

## Applied fixes

React, React DOM, and react-server-dom-webpack move together from 19.2.6 to
19.2.8. The installed Vinext and RSC plugin accept these versions. The RSC patch
addresses a crafted-request denial of service; declaring the package as a
development dependency does not exclude it from the Worker bundle. See the
[React security advisory](https://github.com/react/react/security/advisories/GHSA-wx67-qw84-cm4g).

The following indirect packages were updated inside the existing dependency
ranges. Related Babel helpers and browser data also move where needed by those
packages. No package override or forced audit repair is used.

| Package | Previous version | Resolved version |
| --- | --- | --- |
| @babel/core | 7.29.0 | 7.29.7 |
| brace-expansion | 1.1.14 / 5.0.6 | 1.1.18 / 5.0.9 |
| browserslist | 4.28.2 | 4.28.9 |
| fast-uri | 3.1.2 | 3.1.7 |
| fflate | 0.7.4 | 0.7.5 |
| js-yaml | 4.1.1 | 4.3.2 |
| nanoid | 3.3.12 | 3.3.18 |

The exact changes are in package-lock.json. Fresh locked installation, strict
types, lint, coverage, the Worker build, and rendered HTML are release gates for
this update. These checks do not demonstrate absence of exploitable defects.

## Remaining findings

| Affected packages | Count and severity | Exposure review and next step |
| --- | --- | --- |
| @cloudflare/vite-plugin, miniflare, wrangler, undici, ws | Five high | The local development/emulation toolchain brings HTTP and WebSocket dependencies. Upgrade the Cloudflare toolchain together, then validate Worker build, local serving, and deployment compatibility. |
| sharp | One high | Native image handling is reached through Next and the local emulator. Check its parent constraints during the toolchain update; do not force a native-library override. |
| next, postcss | Two high | Next is installed for framework compatibility; Vinext serves this game. Review each advisory against the generated Worker and update supported parent versions. The app currently has no Server Actions, image upload route, or authored rewrites. This is a reachability review, not an exploit test. |
| vite | One high | The advisory targets the Windows development server. The documented setup uses Linux/WSL, and production runs a built Worker. Apply a compatible Vite fix with the framework/toolchain upgrade; keep development servers private. |
| vinext, image-size | Two high | Vinext pulls image-size 2.0.2. The reviewed use reads local metadata images; no user image upload route is present. The linked image-size advisory lists no patched version. Review a supported Vinext change that removes or replaces the affected path. |
| drizzle-kit, @esbuild-kit/core-utils, @esbuild-kit/esm-loader, esbuild | Four moderate | These belong to optional database/migration tooling. No D1 binding or active game database is configured. Replace the legacy loader through a supported Drizzle update, or remove the optional scaffolding in a deliberate cleanup. |

Some Next advisories need specific features. For example, its
[Server Action denial-of-service advisory](https://github.com/vercel/next.js/security/advisories/GHSA-m99w-x7hq-7vfj)
requires at least one Server Action. That condition was not found in application
source. This does not dismiss other Next findings or the separately patched React
decoder. The [image-size advisory](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr)
describes a malformed ICNS image causing a non-terminating loop.

Do not run `npm audit fix --force` as a release step. In this scan, npm proposes
Vinext 1.0.0-beta.9 and a Drizzle downgrade to 0.18.1. Those are platform changes,
not verified repairs for this project. Several other findings need newer pinned
parent packages. Keep them visible until an explicit compatibility update passes
the relevant source, local runtime, and hardware checks.

## Repeat the review

1. Install the committed lockfile using the repository's install helper.
2. Run `npm audit --json`; retain the date and full dependency paths during review.
3. Read the upstream advisories and check application and generated Worker paths.
4. Apply supported fixes, inspect lockfile changes, and rerun the release gates.
5. Update this report with resolved and outstanding findings. Never use package
   category alone to infer whether code ships in production.
