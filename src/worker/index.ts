// Cloudflare Worker entry — the HTTP API Clay calls.
//
//   GET /?domain=acme.com           -> tech-stack JSON
//   GET /?domain=acme.com&assets=1  -> also fetch JS bundles (slower)
//   GET /health                     -> { ok: true }
//
// Always responds HTTP 200 with a `status` field (ok | partial | error) so a
// single bad domain never errors Clay's HTTP step mid-batch. The whole
// fingerprint set is compiled once at global scope (well within the 1s startup
// budget) and reused across requests; per-request work is just fetch + match.

import { detect } from "../core/detect.js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") return json({ ok: true });

    // Accept ?domain= or ?url=; also tolerate the domain as the path (/acme.com).
    const raw =
      url.searchParams.get("domain") ??
      url.searchParams.get("url") ??
      (url.pathname.length > 1 ? decodeURIComponent(url.pathname.slice(1)) : null);

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
  },
};
