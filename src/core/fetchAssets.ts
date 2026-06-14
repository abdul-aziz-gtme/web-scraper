// Optional stage 2 of fetching: pull a few first-party JS bundles so the matcher
// can inspect their *contents* (the `scripts` pattern type) for deeper signals —
// framework globals, inlined SDK names, etc. Strictly bounded: at most 3 files,
// each capped, well under the Workers 50-subrequest limit. Network wait is free
// CPU-wise; only the later regex matching costs the 10ms budget.

const MAX_JS_FILES = 3;
const MAX_JS_BYTES = 256 * 1024;
const JS_FETCH_TIMEOUT_MS = 6_000;

// We already detect well-known third parties by their script URL, so fetching
// their bodies adds cost without signal. Skip them and spend the budget on
// first-party bundles, which are where framework/build hints live.
const SKIP_HOSTS =
  /(?:googletagmanager|google-analytics|connect\.facebook|snap\.licdn|hotjar|cdn\.segment|js\.hs-scripts|js\.hs-analytics|doubleclick|googleadservices|cloudflareinsights|gstatic|fonts\.googleapis)/i;

// Prefer bundles whose names suggest the app entrypoint.
const PREFER_RE = /(?:app|main|bundle|runtime|chunk|index|vendor|polyfill)[.\-_]?[\w]*\.js/i;

function pickScripts(scriptSrcs: string[], finalUrl: string): string[] {
  let origin = "";
  try {
    origin = new URL(finalUrl).origin;
  } catch {
    /* ignore */
  }
  const sameOrigin = scriptSrcs.filter(
    (s) => !SKIP_HOSTS.test(s) && (origin ? s.startsWith(origin) : true),
  );
  const preferred = sameOrigin.filter((s) => PREFER_RE.test(s));
  const rest = sameOrigin.filter((s) => !PREFER_RE.test(s));
  return [...preferred, ...rest].slice(0, MAX_JS_FILES);
}

async function fetchOne(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JS_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; techstack-detector)" },
    });
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < MAX_JS_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.byteLength;
      }
    }
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }
    const merged = new Uint8Array(Math.min(total, MAX_JS_BYTES));
    let off = 0;
    for (const c of chunks) {
      if (off >= merged.length) break;
      merged.set(c.subarray(0, Math.min(c.byteLength, merged.length - off)), off);
      off += c.byteLength;
    }
    // ignoreBOM spelled out too, so this type-checks under @cloudflare/workers-types
    // (which requires it) as well as DOM/Node. Values are the defaults.
    return new TextDecoder("utf-8", { fatal: false, ignoreBOM: false }).decode(
      merged,
    );
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchAssets(
  scriptSrcs: string[],
  finalUrl: string,
): Promise<string[]> {
  const picks = pickScripts(scriptSrcs, finalUrl);
  if (picks.length === 0) return [];
  const bodies = await Promise.all(picks.map(fetchOne));
  return bodies.filter((b): b is string => b !== null);
}
