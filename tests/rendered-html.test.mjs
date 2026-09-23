import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Directives that break nothing this game renders. Scripts and styles stay
 * unrestricted: the RSC payload arrives in inline script tags.
 */
const CONTENT_SECURITY_POLICY = "object-src 'none'; base-uri 'self'; form-action 'self'";

async function renderHome() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("renders the game metadata and entry shell", async () => {
  const response = await renderHome();

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  assert.match(html, /<title>Stillpoint Frontier<\/title>/i);
  assert.match(html, /continuous first-person, third-person, and isometric views/i);
  assert.match(html, /data-testid=["']game-shell["']/i);
  assert.doesNotMatch(html, /codex-preview/i);
});

test("blocks plugins, base rewrites and foreign form targets on rendered documents", async () => {
  const response = await renderHome();

  assert.equal(response.headers.get("content-security-policy"), CONTENT_SECURITY_POLICY);
});

test("sends the same content security policy from Vercel previews", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  const documents = config.headers.find((entry) => entry.source === "/(.*)");
  const policy = documents?.headers.find((header) => header.key === "Content-Security-Policy");

  assert.equal(policy?.value, CONTENT_SECURITY_POLICY);
});
