// Vercel Edge Function entry — the HTTP API Clay (or anything) calls.
//
//   GET /?domain=acme.com            -> tech-stack JSON (incl. HubSpot detection)
//   GET /api?domain=acme.com         -> same (canonical Vercel path)
//   GET /api?domain=acme.com&assets=1-> also fetch JS bundles (slower)
//   GET /health  (or /api/health)    -> { ok: true }
//
// Mirrors src/worker/index.ts so detection behaviour is identical to the
// Cloudflare deployment. Runs on Vercel's Edge runtime, which provides the same
// Web-standard fetch/Request/Response/streams the runtime-agnostic core uses, so
// nothing under src/core/ had to change.
//
// Always responds HTTP 200 with a `status` field (ok | partial | error) so a
// single bad domain never errors Clay's HTTP step mid-batch.

import { detect } from "../src/core/detect.js";

// Tell Vercel to run this on the Edge runtime (fast cold start, global, free on
// Hobby). The whole fingerprint set is compiled once at module scope and reused
// across requests on a warm isolate; per-request work is just fetch + match.
export const config = { runtime: "edge" };

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  // Permit calling the API from a browser / Google Sheets / Clay without a proxy.
  "access-control-allow-origin": "*",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);

  // Normalize the path so the same logic works whether the request hit `/`,
  // `/api`, or was rewritten through `/api/...` by vercel.json.
  const path = url.pathname.replace(/^\/api(?=\/|$)/, "") || "/";

  if (path === "/health") return json({ ok: true });

  // Accept ?domain= or ?url=; also tolerate the domain as the path (/acme.com).
  const raw =
    url.searchParams.get("domain") ??
    url.searchParams.get("url") ??
    (path.length > 1 ? decodeURIComponent(path.slice(1)) : null);

  if (!raw) {
    return json(
      { status: "error", error: "missing 'domain' query parameter" },
      400,
    );
  }

  const assets = url.searchParams.get("assets") === "1";

  try {
    const result = await detect(raw, { fetchAssets: assets });
    return json(result);
  } catch (e) {
    // Defensive: detect() already soft-fails, but never let an exception turn
    // into a non-200 that would break Clay's batch step.
    return json({
      domain: raw,
      status: "error",
      error: e instanceof Error ? e.message : String(e),
      cms: [],
      cms_primary: null,
      crm: [],
      crm_primary: null,
      all: [],
    });
  }
}
