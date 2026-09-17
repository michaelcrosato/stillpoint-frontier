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

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handler.fetch(request, env, ctx);
  },
};

export default worker;
