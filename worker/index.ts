/** Cloudflare Worker entry point for the vinext-starter template. */
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// The starter template routes /_vinext/image through Cloudflare Images. This
// game ships no next/image usage and no IMAGES binding is declared in
// .openai/hosting.json or vite.config.ts, so that route could only dereference
// an undefined binding on a public path. Reinstate it together with the
// binding if optimized images are ever added.

/**
 * Applied to documents this Worker renders. Static assets are served straight
 * from the assets binding and never reach this handler; they are content-hashed,
 * immutable and carry no credentials.
 *
 * No Content-Security-Policy: the RSC payload arrives in inline script tags, so
 * a policy worth having needs a per-response nonce, which this entry point
 * cannot mint without buffering and rewriting every document.
 *
 * No X-Frame-Options / frame-ancestors: whether the hosting platform frames the
 * site for previews is not documented, and breaking a live preview is a worse
 * outcome than clickjacking a game that has no authenticated or
 * server-authoritative action. Add "X-Frame-Options": "SAMEORIGIN" below if the
 * site is confirmed never to be embedded.
 */
const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
};

/** Responses that must not carry a body when reconstructed. */
const BODILESS_STATUS = new Set([204, 205, 304]);

function withSecurityHeaders(response: Response): Response {
  // A WebSocket upgrade carries a socket the Response constructor cannot copy,
  // and the constructor rejects any status below 200 outright. Pass those
  // through untouched; they are not documents and need no document headers.
  if (response.status < 200 || response.webSocket) return response;

  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  return new Response(BODILESS_STATUS.has(response.status) ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return withSecurityHeaders(await handler.fetch(request, env, ctx));
  },
};

export default worker;
