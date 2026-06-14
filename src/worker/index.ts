// Cloudflare Worker entry — the HTTP API Clay calls.
//
//   GET /?domain=acme.com           -> tech-stack JSON
//   GET /?domain=acme.com&assets=1  -> also fetch JS bundles (slower)
//   GET /health                     -> { ok: true }
//
// Always responds HTTP 200 with a `status` field (ok | partial | error) so a
// single bad domain never errors Clay's HTTP step mid-batch (except 429/405). The
// whole fingerprint set is compiled once at global scope (well within the 1s
// startup budget) and reused across requests; per-request work is just fetch +
// match. SSRF to internal hosts is blocked in the detection core (ssrfGuard).

import { detect } from "../core/detect.js";
import { checkRateLimit, clientIpFrom } from "../core/rateLimit.js";

const SECURITY_HEADERS: Record<string, string> = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "Content-Type",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
};

function json(
  body: unknown,
  status = 200,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...SECURITY_HEADERS, ...extra },
  });
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: SECURITY_HEADERS });
    }
    if (method !== "GET" && method !== "HEAD") {
      return json({ status: "error", error: "method not allowed" }, 405, {
        allow: "GET, HEAD, OPTIONS",
      });
    }

    if (url.pathname === "/health") return json({ ok: true });

    // Best-effort per-IP rate limit (defense in depth; see rateLimit.ts caveat).
    const ip = clientIpFrom((name) => request.headers.get(name));
    const rl = checkRateLimit(ip, Date.now());
    const rlHeaders = {
      "x-ratelimit-limit": String(rl.limit),
      "x-ratelimit-remaining": String(rl.remaining),
    };
    if (!rl.ok) {
      return json({ status: "error", error: "rate limit exceeded" }, 429, {
        ...rlHeaders,
        "retry-after": String(rl.retryAfterSec),
      });
    }

    // Accept ?domain= or ?url=; also tolerate the domain as the path (/acme.com).
    const raw =
      url.searchParams.get("domain") ??
      url.searchParams.get("url") ??
      (url.pathname.length > 1 ? decodeURIComponent(url.pathname.slice(1)) : null);

    if (!raw) {
      return json(
        { status: "error", error: "missing 'domain' query parameter" },
        400,
        rlHeaders,
      );
    }

    const assets = url.searchParams.get("assets") === "1";

    try {
      const result = await detect(raw, { fetchAssets: assets });
      return json(result, 200, rlHeaders);
    } catch (e) {
      // Defensive: detect() already soft-fails, but never let an exception turn
      // into a non-200 that would break Clay's batch step.
      return json(
        {
          domain: raw,
          status: "error",
          error: e instanceof Error ? e.message : String(e),
          cms: [],
          cms_primary: null,
          crm: [],
          crm_primary: null,
          all: [],
        },
        200,
        rlHeaders,
      );
    }
  },
};
