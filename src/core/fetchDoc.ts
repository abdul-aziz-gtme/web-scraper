// Stage 1 of detection: fetch the homepage. Runtime-agnostic — uses only the
// web-standard fetch/Response, so it behaves identically under Node (tsx CLI) and
// the Workers runtime. Sends a realistic browser UA to reduce 403s, follows
// redirects, caps the body, and soft-fails (returns partial/error) rather than
// throwing, so a single bad domain never breaks a batch.

import { extractRefs } from "./extractRefs.js";
import { assertPublicUrl, assertHostResolvesPublic } from "./ssrfGuard.js";
import type { FetchedDoc } from "./types.js";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const MAX_HTML_BYTES = 768 * 1024; // ~768KB cap on homepage HTML
const FETCH_TIMEOUT_MS = 12_000; // well under Clay's 30s wall-clock
const MAX_REDIRECTS = 5; // follow redirects manually so we can re-check each hop

export interface FetchOptions {
  timeoutMs?: number;
  maxHtmlBytes?: number;
}

// Normalize a user-supplied domain/URL into a fetchable https URL.
export function normalizeUrl(input: string): string {
  let s = input.trim();
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  return s;
}

// Read a response body but stop once we've buffered `maxBytes`, so a giant page
// can't blow memory or waste CPU on decoding.
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const body = res.body;
  if (!body) return await res.text();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.byteLength;
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
  }
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    merged.set(c.subarray(0, Math.min(c.byteLength, total - off)), off);
    off += c.byteLength;
    if (off >= total) break;
  }
  // Both options spelled out so this type-checks under every runtime's
  // TextDecoder typings (DOM, Node, and @cloudflare/workers-types — the last of
  // which requires `ignoreBOM`). Values are the defaults; behaviour is unchanged.
  return new TextDecoder("utf-8", { fatal: false, ignoreBOM: false }).decode(
    merged,
  );
}

function headersToRecord(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

// Parse Set-Cookie names/values from the response. Workers exposes raw set-cookie
// via Headers.getSetCookie(); Node's fetch does too on recent versions.
function parseCookies(h: Headers): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  let raw: string[] = [];
  const anyH = h as unknown as { getSetCookie?: () => string[] };
  if (typeof anyH.getSetCookie === "function") {
    raw = anyH.getSetCookie();
  } else {
    const sc = h.get("set-cookie");
    if (sc) raw = [sc];
  }
  for (const line of raw) {
    const first = line.split(";", 1)[0] ?? "";
    const eq = first.indexOf("=");
    if (eq > 0) {
      out.push({ name: first.slice(0, eq).trim(), value: first.slice(eq + 1).trim() });
    }
  }
  return out;
}

export async function fetchDoc(
  domain: string,
  opts: FetchOptions = {},
): Promise<FetchedDoc> {
  const url = normalizeUrl(domain);
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxBytes = opts.maxHtmlBytes ?? MAX_HTML_BYTES;

  const base: FetchedDoc = {
    requestedDomain: domain,
    finalUrl: url,
    fetchStatus: "error",
    html: "",
    headers: {},
    cookies: [],
    scriptSrcs: [],
    metas: [],
    scripts: [],
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // SSRF defense: follow redirects ourselves so the guard runs on every hop —
    // a public site must not be able to 30x-redirect us into the internal network.
    let currentUrl = url;
    let res: Response | null = null;
    for (let hop = 0; ; hop++) {
      const target = assertPublicUrl(currentUrl); // scheme + IP/host literal checks
      await assertHostResolvesPublic(target.hostname); // DNS-resolves-public (Node)

      res = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        try {
          await res.body?.cancel();
        } catch {
          /* ignore */
        }
        if (!loc) break; // 3xx without Location — treat as the final response
        if (hop >= MAX_REDIRECTS) throw new Error("too many redirects");
        currentUrl = new URL(loc, currentUrl).toString();
        continue;
      }
      break; // non-redirect — this is the response we read
    }
    if (!res) throw new Error("no response");

    base.finalUrl = currentUrl;
    base.httpStatus = res.status;
    base.headers = headersToRecord(res.headers);
    base.cookies = parseCookies(res.headers);
    base.html = await readCapped(res, maxBytes);

    const refs = extractRefs(base.html, base.finalUrl);
    base.scriptSrcs = refs.scriptSrcs;
    base.metas = refs.metas;

    // Headers alone can fingerprint hosting/CDN even on a non-200, so treat any
    // response we read as usable; mark partial when the status is unhappy.
    base.fetchStatus = res.status >= 200 && res.status < 400 ? "ok" : "partial";
    return base;
  } catch (err) {
    base.fetchStatus = "error";
    base.error = err instanceof Error ? err.message : String(err);
    return base;
  } finally {
    clearTimeout(timer);
  }
}
