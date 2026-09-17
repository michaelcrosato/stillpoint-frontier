/**
 * Renders the entry route to dist/client/index.html so the built output can be
 * served by a plain static host.
 *
 * The game is client-side: the Worker's only job for `/` is emitting the shell
 * plus an inline RSC payload, and it reads no headers or cookies, so the result
 * is deterministic and safe to bake at build time.
 *
 * This runs only from `build:vercel`, never from `build`. That matters: a
 * Cloudflare Worker with an assets directory serves a matching static file
 * before invoking the Worker, so an index.html in dist/client would shadow the
 * live render there and bypass the Worker's response headers.
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const projectRoot = new URL("../", import.meta.url);
const workerUrl = new URL("dist/server/index.js", projectRoot);
const outputPath = fileURLToPath(new URL("dist/client/index.html", projectRoot));

const { default: worker } = await import(workerUrl.href);

const response = await worker.fetch(
  new Request("http://localhost/", { headers: { accept: "text/html" } }),
  {
    ASSETS: {
      fetch: async () => new Response("Not found", { status: 404 }),
    },
  },
  { waitUntil() {}, passThroughOnException() {} },
);

if (response.status !== 200) {
  throw new Error(`Prerender expected 200, received ${response.status}.`);
}

const html = await response.text();

// Guard against shipping a shell that cannot boot. Each check has failed in a
// real build at some point during development of this script.
const required = [
  [/<title>Stillpoint Frontier<\/title>/i, "document title"],
  [/data-testid=["']game-shell["']/i, "game shell mount point"],
  [/vinext\.navigationRuntime/, "inline RSC bootstrap payload"],
  [/\/_next\/static\/chunks\/GameShell-[^"']+\.js/, "GameShell client chunk"],
];
for (const [pattern, label] of required) {
  if (!pattern.test(html)) throw new Error(`Prerendered HTML is missing the ${label}.`);
}

await writeFile(outputPath, html);
console.log(`[prerender] wrote ${outputPath} (${html.length} bytes)`);
