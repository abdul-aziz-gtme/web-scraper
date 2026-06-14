// Lightweight in-memory, per-IP sliding-window rate limiter. Runtime-agnostic and
// dependency-free, so it works on both Vercel (Node) and Cloudflare Workers.
//
// Honest caveat: serverless instances don't share memory, so this limits each warm
// instance independently — it blunts a single hot caller and accidental loops, but
// it is NOT a substitute for an edge/WAF rate limit backed by shared state (Vercel
// Firewall, Cloudflare Rate Limiting, or an Upstash/Redis counter) for a determined
// distributed attacker. It is defense-in-depth, not the whole defense.

export interface RateDecision {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
  limit: number;
}

const WINDOW_MS = 60_000; // 1 minute
const MAX_PER_WINDOW = 40; // requests per IP per window
const MAX_TRACKED_IPS = 10_000; // memory bound

const buckets = new Map<string, number[]>();

export function checkRateLimit(
  ip: string,
  now: number,
  opts: { windowMs?: number; max?: number } = {},
): RateDecision {
  const windowMs = opts.windowMs ?? WINDOW_MS;
  const max = opts.max ?? MAX_PER_WINDOW;

  const prior = buckets.get(ip);
  const recent = prior ? prior.filter((t) => now - t < windowMs) : [];

  // Opportunistic cleanup so the map can't grow unbounded under many distinct IPs.
  if (buckets.size > MAX_TRACKED_IPS) {
    for (const [k, v] of buckets) {
      const last = v[v.length - 1];
      if (last === undefined || now - last >= windowMs) buckets.delete(k);
    }
  }

  if (recent.length >= max) {
    buckets.set(ip, recent);
    const oldest = recent[0] ?? now;
    const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
    return { ok: false, remaining: 0, retryAfterSec, limit: max };
  }

  recent.push(now);
  buckets.set(ip, recent);
  return { ok: true, remaining: max - recent.length, retryAfterSec: 0, limit: max };
}

// Pull the best-effort client IP from proxy headers. `get` returns a header value
// (or null) — works with both Node's req.headers and the Fetch Headers API.
export function clientIpFrom(get: (name: string) => string | null): string {
  const xff = get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return get("x-real-ip")?.trim() || get("cf-connecting-ip")?.trim() || "unknown";
}
