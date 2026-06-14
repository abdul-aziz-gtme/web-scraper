// Shared builder that turns raw, human/JSON-authored fingerprint data into a
// runtime Technology (with compiled patterns). Used by both the hand-curated set
// (curated.ts) and the build-compiled webappanalyzer set
// (fingerprints.generated.ts), so the two never diverge.

import { compilePattern } from "./compile.js";
import type { CategoryKey, CompiledPattern, Technology } from "./types.js";

export interface RawTechData {
  name: string;
  cats: CategoryKey[];
  html?: string[];
  scriptSrc?: string[];
  scripts?: string[];
  url?: string[];
  meta?: Record<string, string>;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
  implies?: string[];
  requires?: string[];
  excludes?: string[];
}

function compileList(raws: string[] | undefined): CompiledPattern[] | undefined {
  if (!raws || raws.length === 0) return undefined;
  const out: CompiledPattern[] = [];
  for (const r of raws) {
    const p = compilePattern(r);
    if (p) out.push(p);
  }
  return out.length ? out : undefined;
}

function compileKeyed(
  obj: Record<string, string> | undefined,
): CompiledPattern[] | undefined {
  if (!obj) return undefined;
  const out: CompiledPattern[] = [];
  for (const [key, raw] of Object.entries(obj)) {
    const p = compilePattern(raw, key);
    if (p) out.push(p);
  }
  return out.length ? out : undefined;
}

export function buildTech(r: RawTechData): Technology {
  const t: Technology = {
    name: r.name,
    cats: r.cats,
    patterns: {
      html: compileList(r.html),
      scriptSrc: compileList(r.scriptSrc),
      scripts: compileList(r.scripts),
      url: compileList(r.url),
      meta: compileKeyed(r.meta),
      headers: compileKeyed(r.headers),
      cookies: compileKeyed(r.cookies),
    },
  };
  if (r.implies) t.implies = r.implies;
  if (r.requires) t.requires = r.requires;
  if (r.excludes) t.excludes = r.excludes;
  return t;
}
