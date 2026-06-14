// Vercel Node serverless function — the HTTP API Clay (or anything) calls.
//
//   GET /?domain=acme.com            -> tech-stack JSON (incl. HubSpot detection)
//   GET /api?domain=acme.com         -> same (canonical Vercel path)
//   GET /api?domain=acme.com&assets=1-> also fetch JS bundles (slower)
//   GET /acme.com                    -> domain as the path
//   GET /health                      -> { ok: true }
//
// Uses the same runtime-agnostic detection core as the Cloudflare Worker
// (src/core/), so results are identical. Runs on Vercel's Node runtime (Node 20),
// which has global fetch / streams / AbortController — everything the core needs.
//
// vercel.json routes every request to this function (`/api/index`) and passes the
// real intent on the query string (`domain=`, `__health=1`), so we just read
// req.query. Always responds HTTP 200 with a `status` field (ok | partial |
// error) so one bad domain never errors Clay's HTTP step mid-batch.

import { detect } from "../src/core/detect.js";

// Minimal shapes for Vercel's Node (req, res) signature — avoids pulling in the
// @vercel/node package just for types. These are the only members we touch.
interface VercelRequest {
  query: Record<string, string | string[] | undefined>;
  url?: string;
}
interface VercelResponse {
  status(code: number): VercelResponse;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
}

// req.query values can be string | string[] (repeated params); take the first.
function first(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  // Allow calling the API from a browser / Google Sheets / Clay without a proxy.
  res.setHeader("access-control-allow-origin", "*");

  const q = req.query ?? {};

  if (first(q.__health) === "1") {
    res.status(200).json({ ok: true });
    return;
  }

  // Landing/root: no domain to detect, so return usage instead of a 400 that
  // would make the site look broken when opened in a browser.
  if (first(q.__root) === "1" && !first(q.domain) && !first(q.url)) {
    res.status(200).json({
      service: "techstack-detector",
      status: "ok",
      usage: {
        detect: "/api?domain=acme.com",
        detect_with_assets: "/api?domain=acme.com&assets=1",
        pretty_path: "/acme.com",
        health: "/health",
      },
    });
    return;
  }

  const raw = first(q.domain) ?? first(q.url);
  if (!raw) {
    res
      .status(400)
      .json({ status: "error", error: "missing 'domain' query parameter" });
    return;
  }

  const assets = first(q.assets) === "1";

  try {
    const result = await detect(raw, { fetchAssets: assets });
    res.status(200).json(result);
  } catch (e) {
    // Defensive: detect() already soft-fails, but never let an exception turn
    // into a non-200 that would break Clay's batch step.
    res.status(200).json({
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
