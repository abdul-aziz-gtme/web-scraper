// The matcher — the CPU hotspot, designed for the Workers 10ms/request budget.
// For every pattern we first test a cheap lowercase substring (`prefilter`);
// only if it's present do we run the regex. Crucially, the lowercased form of
// each big target is computed ONCE up front (not per-pattern), and the large
// text targets are length-capped — together these keep matching well under 10ms
// even against the full ~3000-tech fingerprint set.

import { gram3 } from "./compile.js";
import type {
  CategoryKey,
  CompiledPattern,
  FetchedDoc,
  Technology,
} from "./types.js";

export interface RawHit {
  cats: CategoryKey[];
  confidence: number;
  version?: string;
}

// Caps on how much of each large target we run regexes against. Tech signals
// (head meta, inline config, script tags) cluster near the top of documents and
// bundles, so these trim CPU with negligible recall loss.
const HTML_CAP = 64 * 1024;
const SCRIPTSRC_CAP = 48 * 1024;
const SCRIPTS_CAP = 128 * 1024;

// 3-gram presence is recorded in a bitmap (Bloom-style, no per-element hashing or
// allocation), which is ~20x faster to populate than a Set and is the single
// O(target) pass that lets pattern gating be O(1) per pattern. Collisions only
// cost an extra includes() verify, never a missed match.
const GRAM_BITS = 1 << 20; // ~1M buckets
const GRAM_MASK = GRAM_BITS - 1;

interface Target {
  raw: string;
  lower: string;
  bits: Uint8Array;
}

function mkTarget(s: string, cap: number): Target {
  const raw = s.length > cap ? s.slice(0, cap) : s;
  const lower = raw.toLowerCase();
  const bits = new Uint8Array(GRAM_BITS >> 3);
  const n = lower.length;
  for (let i = 0; i + 2 < n; i++) {
    const idx = (gram3(lower, i) >>> 0) & GRAM_MASK;
    bits[idx >> 3]! |= 1 << (idx & 7);
  }
  return { raw, lower, bits };
}

function gramPresent(bits: Uint8Array, h: number): boolean {
  const idx = (h >>> 0) & GRAM_MASK;
  return (bits[idx >> 3]! & (1 << (idx & 7))) !== 0;
}

function resolveVersion(template: string, m: RegExpExecArray): string | undefined {
  const ternary = /^\\(\d+)\?([^:]*):(.*)$/.exec(template);
  if (ternary) {
    const g = m[parseInt(ternary[1]!, 10)];
    return g ? ternary[2] : ternary[3];
  }
  const out = template.replace(/\\(\d+)/g, (_, d) => m[parseInt(d, 10)] ?? "");
  return out.trim() || undefined;
}

// Test one pattern against a pre-lowercased target. Returns the extracted version
// ("" for a match with no version) or null for no match.
function testOn(p: CompiledPattern, t: Target): string | null {
  if (!t.raw) return null;
  const grams = p.gramKeys;
  if (grams) {
    // Gated pattern: pass only if a prefilter's gram is present AND the full
    // literal really occurs (verify guards against gram-hash collisions).
    let candidate = false;
    for (let i = 0; i < grams.length; i++) {
      if (gramPresent(t.bits, grams[i]!) && t.lower.includes(p.prefilters![i]!)) {
        candidate = true;
        break;
      }
    }
    if (!candidate) return null;
  }
  // Ungated patterns (no safe literal) fall through and always run the regex.
  const m = p.re.exec(t.raw);
  if (!m) return null;
  if (p.version) return resolveVersion(p.version, m) ?? "";
  return "";
}

// Small keyed values (header/meta/cookie) — tiny targets, so a direct includes()
// gate is fine (no gram index needed).
function testSmall(p: CompiledPattern, value: string): string | null {
  const v = value || " ";
  if (p.prefilters) {
    const lower = v.toLowerCase();
    let candidate = false;
    for (const pf of p.prefilters) {
      if (lower.includes(pf)) {
        candidate = true;
        break;
      }
    }
    if (!candidate) return null;
  }
  const m = p.re.exec(v);
  if (!m) return null;
  if (p.version) return resolveVersion(p.version, m) ?? "";
  return "";
}

function record(
  hits: Map<string, RawHit>,
  tech: Technology,
  confidence: number,
  version: string,
): void {
  const existing = hits.get(tech.name);
  if (existing) {
    existing.confidence = Math.min(100, existing.confidence + confidence);
    if (!existing.version && version) existing.version = version;
  } else {
    hits.set(tech.name, {
      cats: tech.cats,
      confidence: Math.min(100, confidence),
      version: version || undefined,
    });
  }
}

export function matchTechnologies(
  techs: Technology[],
  doc: FetchedDoc,
): Map<string, RawHit> {
  const hits = new Map<string, RawHit>();

  // Lowercase + cap + gram-index each multi-value target ONCE.
  const html = mkTarget(doc.html, HTML_CAP);
  const scriptSrc = mkTarget(doc.scriptSrcs.join("\n"), SCRIPTSRC_CAP);
  const scripts = mkTarget(doc.scripts.join("\n"), SCRIPTS_CAP);
  const url = mkTarget(doc.finalUrl, 4096);

  for (const tech of techs) {
    const pats = tech.patterns;

    if (pats.html) {
      for (const p of pats.html) {
        const v = testOn(p, html);
        if (v !== null) record(hits, tech, p.confidence, v);
      }
    }
    if (pats.scriptSrc) {
      for (const p of pats.scriptSrc) {
        const v = testOn(p, scriptSrc);
        if (v !== null) record(hits, tech, p.confidence, v);
      }
    }
    if (pats.scripts && scripts.raw) {
      for (const p of pats.scripts) {
        const v = testOn(p, scripts);
        if (v !== null) record(hits, tech, p.confidence, v);
      }
    }
    if (pats.url) {
      for (const p of pats.url) {
        const v = testOn(p, url);
        if (v !== null) record(hits, tech, p.confidence, v);
      }
    }
    if (pats.meta) {
      for (const p of pats.meta) {
        if (!p.key) continue;
        const meta = doc.metas.find((x) => x.name === p.key);
        if (!meta) continue;
        const v = testSmall(p, meta.content);
        if (v !== null) record(hits, tech, p.confidence, v);
      }
    }
    if (pats.headers) {
      for (const p of pats.headers) {
        if (!p.key) continue;
        let value: string | undefined;
        if (p.key.endsWith("-")) {
          for (const hk in doc.headers) {
            if (hk.startsWith(p.key)) {
              value = doc.headers[hk];
              break;
            }
          }
        } else {
          value = doc.headers[p.key];
        }
        if (value === undefined) continue;
        const v = testSmall(p, value);
        if (v !== null) record(hits, tech, p.confidence, v);
      }
    }
    if (pats.cookies) {
      for (const p of pats.cookies) {
        if (!p.key) continue;
        const ck = doc.cookies.find((c) => c.name.toLowerCase() === p.key);
        if (!ck) continue;
        const v = testSmall(p, ck.value);
        if (v !== null) record(hits, tech, p.confidence, v);
      }
    }
  }

  return hits;
}
