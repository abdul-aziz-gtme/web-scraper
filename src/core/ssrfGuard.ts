// SSRF guard. The detector fetches arbitrary user-supplied domains server-side,
// so without this an attacker could make our function request internal targets:
// loopback (127.0.0.1), RFC1918 (10/8, 192.168/16, 172.16/12), link-local /
// cloud-metadata (169.254.169.254), or use the deployment as an open proxy /
// port-scanner. This module rejects any URL that doesn't resolve to a public host.
//
// Defenses, layered:
//   1. Protocol allow-list (http/https only) + no embedded credentials.
//   2. IP-literal checks against private/reserved ranges, including the
//      decimal/octal/hex IPv4 encodings (2130706433, 0x7f000001, 0177.0.0.1) and
//      IPv6 (::1, fc00::/7, fe80::/10, IPv4-mapped, NAT64).
//   3. A "must be a dotted public hostname" rule that drops single-label names
//      (localhost, intranet) and internal suffixes (.local, .internal, …).
//   4. (Node only, best-effort) DNS resolution check so a hostname that *resolves*
//      to a private IP is also blocked — closes the "A record -> 169.254.x" vector.
//   5. The caller follows redirects manually and re-runs this guard on every hop,
//      so a public site can't 30x-redirect us into the internal network.
//
// Runtime-agnostic: the WHATWG URL parser (used by both Node and Workers) already
// canonicalizes IPv4 encodings, but we re-parse defensively so the guard never
// depends on that. The DNS step is skipped where node:dns is unavailable (Workers),
// which is fine — that platform's fetch can't reach the internal network anyway.

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

const BLOCKED_HOST_EXACT = new Set([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
]);

// Suffixes that are never a public website (special-use / internal TLDs).
const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".intranet",
  ".lan",
  ".home",
  ".corp",
  ".private",
  ".test",
  ".example",
  ".invalid",
];

// IPv4 ranges to block: [networkBaseAsUint32, prefixBits].
const V4_BLOCKED: ReadonlyArray<readonly [number, number]> = [
  [0x00000000, 8], // 0.0.0.0/8        "this network"
  [0x0a000000, 8], // 10.0.0.0/8       private
  [0x64400000, 10], // 100.64.0.0/10   CGNAT
  [0x7f000000, 8], // 127.0.0.0/8      loopback
  [0xa9fe0000, 16], // 169.254.0.0/16  link-local (cloud metadata 169.254.169.254)
  [0xac100000, 12], // 172.16.0.0/12   private
  [0xc0000000, 24], // 192.0.0.0/24    IETF protocol assignments
  [0xc0000200, 24], // 192.0.2.0/24    TEST-NET-1
  [0xc0586300, 24], // 192.88.99.0/24  6to4 relay anycast
  [0xc0a80000, 16], // 192.168.0.0/16  private
  [0xc6120000, 15], // 198.18.0.0/15   benchmarking
  [0xc6336400, 24], // 198.51.100.0/24 TEST-NET-2
  [0xcb007100, 24], // 203.0.113.0/24  TEST-NET-3
  [0xe0000000, 4], // 224.0.0.0/4      multicast
  [0xf0000000, 4], // 240.0.0.0/4      reserved + 255.255.255.255 broadcast
];

function inV4(addr: number, base: number, bits: number): boolean {
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (~((1 << (32 - bits)) - 1)) >>> 0;
  return ((addr & mask) >>> 0) === ((base & mask) >>> 0);
}

export function isPrivateIPv4(addr: number): boolean {
  const a = addr >>> 0;
  return V4_BLOCKED.some(([base, bits]) => inV4(a, base, bits));
}

// Parse a host as a "loose" IPv4 the way inet_aton / browsers do: dotted parts may
// be decimal, octal (leading 0) or hex (0x…), 1–4 parts, and a bare integer is the
// whole 32-bit address. Returns a uint32, or null if it isn't an IPv4 literal.
export function parseLooseIPv4(host: string): number | null {
  if (!/^[0-9a-fx.]+$/i.test(host)) return null;
  const parts = host.split(".");
  if (parts.length === 0 || parts.length > 4) return null;

  const nums: number[] = [];
  for (const p of parts) {
    if (p === "") return null;
    let n: number;
    if (/^0x[0-9a-f]+$/i.test(p)) n = parseInt(p.slice(2), 16);
    else if (/^0[0-7]+$/.test(p)) n = parseInt(p, 8);
    else if (/^[0-9]+$/.test(p)) n = parseInt(p, 10);
    else return null;
    if (!Number.isFinite(n) || n < 0) return null;
    nums.push(n);
  }

  const len = nums.length;
  const n0 = nums[0]!;
  let addr: number;
  if (len === 1) {
    if (n0 > 0xffffffff) return null;
    addr = n0;
  } else if (len === 2) {
    const n1 = nums[1]!;
    if (n0 > 0xff || n1 > 0xffffff) return null;
    addr = n0 * 0x1000000 + n1;
  } else if (len === 3) {
    const n1 = nums[1]!;
    const n2 = nums[2]!;
    if (n0 > 0xff || n1 > 0xff || n2 > 0xffff) return null;
    addr = n0 * 0x1000000 + n1 * 0x10000 + n2;
  } else {
    const n1 = nums[1]!;
    const n2 = nums[2]!;
    const n3 = nums[3]!;
    if (nums.some((n) => n > 0xff)) return null;
    addr = n0 * 0x1000000 + n1 * 0x10000 + n2 * 0x100 + n3;
  }
  return addr >>> 0;
}

// Parse an IPv6 literal (with or without [brackets], zone id stripped, optional
// trailing embedded IPv4) into 16 bytes, or null if not parseable.
export function parseIPv6(raw: string): Uint8Array | null {
  let h = raw;
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  h = h.split("%")[0] ?? h; // drop zone id
  if (!h.includes(":")) return null;

  // Convert a trailing embedded IPv4 (e.g. ::ffff:127.0.0.1) into two hextets.
  if (h.includes(".")) {
    const idx = h.lastIndexOf(":");
    const v4 = parseLooseIPv4(h.slice(idx + 1));
    if (v4 === null) return null;
    const hi = ((v4 >>> 16) & 0xffff).toString(16);
    const lo = (v4 & 0xffff).toString(16);
    h = h.slice(0, idx + 1) + hi + ":" + lo;
  }

  const halves = h.split("::");
  if (halves.length > 2) return null;
  const h0 = halves[0] ?? "";
  const head = h0 ? h0.split(":") : [];
  const h1 = halves.length === 2 ? (halves[1] ?? "") : null;
  const tail = h1 === null ? null : h1 ? h1.split(":") : [];

  let hextets: string[];
  if (tail === null) {
    if (head.length !== 8) return null;
    hextets = head;
  } else {
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null;
    hextets = [...head, ...Array(missing).fill("0"), ...tail];
  }
  if (hextets.length !== 8) return null;

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const part = hextets[i];
    if (!part || !/^[0-9a-f]{1,4}$/i.test(part)) return null;
    const val = parseInt(part, 16);
    bytes[i * 2] = (val >>> 8) & 0xff;
    bytes[i * 2 + 1] = val & 0xff;
  }
  return bytes;
}

export function isPrivateIPv6(b: Uint8Array): boolean {
  if (b.length !== 16) return true; // malformed -> treat as unsafe
  const at = (i: number): number => b[i] ?? 0; // length verified above
  const allZeroUpTo = (n: number) => {
    for (let i = 0; i < n; i++) if (at(i) !== 0) return false;
    return true;
  };
  // ::1 loopback
  if (allZeroUpTo(15) && at(15) === 1) return true;
  // :: unspecified
  if (allZeroUpTo(16)) return true;
  // fc00::/7 unique-local
  if ((at(0) & 0xfe) === 0xfc) return true;
  // fe80::/10 link-local
  if (at(0) === 0xfe && (at(1) & 0xc0) === 0x80) return true;
  // ff00::/8 multicast
  if (at(0) === 0xff) return true;
  // 2001:db8::/32 documentation
  if (at(0) === 0x20 && at(1) === 0x01 && at(2) === 0x0d && at(3) === 0xb8) return true;
  const embeddedV4 = () =>
    ((at(12) << 24) | (at(13) << 16) | (at(14) << 8) | at(15)) >>> 0;
  // ::ffff:0:0/96 IPv4-mapped -> evaluate the embedded v4
  if (allZeroUpTo(10) && at(10) === 0xff && at(11) === 0xff) {
    return isPrivateIPv4(embeddedV4());
  }
  // 64:ff9b::/96 NAT64 -> evaluate the embedded v4
  if (at(0) === 0x00 && at(1) === 0x64 && at(2) === 0xff && at(3) === 0x9b) {
    return isPrivateIPv4(embeddedV4());
  }
  return false;
}

// Throw if a hostname (as taken from URL.hostname) is not a public internet host.
export function assertPublicHost(hostnameRaw: string): void {
  const hostname = hostnameRaw.trim().toLowerCase().replace(/\.$/, "");
  if (!hostname) throw new SsrfError("blocked: empty host");

  // IPv6 literal (URL.hostname wraps these in brackets).
  if (hostname.startsWith("[")) {
    const b = parseIPv6(hostname);
    if (!b) throw new SsrfError("blocked: unparseable IPv6 literal");
    if (isPrivateIPv6(b)) throw new SsrfError("blocked: non-public IPv6 address");
    return;
  }

  // IPv4 literal in any encoding.
  const v4 = parseLooseIPv4(hostname);
  if (v4 !== null) {
    if (isPrivateIPv4(v4)) throw new SsrfError("blocked: non-public IPv4 address");
    return;
  }

  // A stray ':' that isn't a bracketed IPv6 is not a valid public host.
  if (hostname.includes(":")) throw new SsrfError("blocked: invalid host");

  // DNS name.
  if (BLOCKED_HOST_EXACT.has(hostname)) throw new SsrfError("blocked: internal host");
  for (const suf of BLOCKED_HOST_SUFFIXES) {
    if (hostname === suf.slice(1) || hostname.endsWith(suf)) {
      throw new SsrfError("blocked: internal host suffix");
    }
  }
  // Public sites have a registrable domain; single-label names never do.
  if (!hostname.includes(".")) {
    throw new SsrfError("blocked: non-public single-label host");
  }
}

// Validate a full URL string. Returns the parsed URL on success; throws SsrfError.
export function assertPublicUrl(urlStr: string): URL {
  let u: URL;
  try {
    u = new URL(urlStr);
  } catch {
    throw new SsrfError("blocked: invalid URL");
  }
  if (!ALLOWED_PROTOCOLS.has(u.protocol)) {
    throw new SsrfError(`blocked: protocol ${u.protocol}`);
  }
  // user:pass@host can disguise the real host to humans; we don't need creds.
  if (u.username || u.password) {
    throw new SsrfError("blocked: credentials in URL");
  }
  assertPublicHost(u.hostname);
  return u;
}

// Node-only, best-effort: block hostnames that *resolve* to a private IP. On
// runtimes without node:dns (Cloudflare Workers) this is a no-op — that platform's
// fetch can't reach the internal network, so the literal/host checks suffice.
let lookupPromise: Promise<DnsLookup | null> | null = null;
type DnsLookup = (
  host: string,
  opts: { all: true },
) => Promise<Array<{ address: string; family: number }>>;

function getLookup(): Promise<DnsLookup | null> {
  if (lookupPromise === null) {
    lookupPromise = import("node:dns/promises")
      .then((m) => m.lookup as unknown as DnsLookup)
      .catch(() => null);
  }
  return lookupPromise;
}

export async function assertHostResolvesPublic(hostname: string): Promise<void> {
  // IP literals are already fully validated by assertPublicHost.
  if (hostname.startsWith("[") || parseLooseIPv4(hostname) !== null) return;

  const lookup = await getLookup();
  if (!lookup) return; // no DNS API on this runtime -> rely on platform + host rules

  let addrs: Array<{ address: string; family: number }>;
  try {
    addrs = await lookup(hostname, { all: true });
  } catch {
    return; // transient/NXDOMAIN — let the real fetch surface the failure
  }
  for (const a of addrs) {
    if (a.family === 6) {
      const b = parseIPv6(a.address);
      if (b && isPrivateIPv6(b)) {
        throw new SsrfError("blocked: host resolves to a non-public address");
      }
    } else {
      const v4 = parseLooseIPv4(a.address);
      if (v4 !== null && isPrivateIPv4(v4)) {
        throw new SsrfError("blocked: host resolves to a non-public address");
      }
    }
  }
}
