// Shared types for the tech-stack detector.
// Both the hand-curated fingerprints and the build-compiled webappanalyzer
// fingerprints produce the same `Technology` shape, so `match.ts` treats them
// uniformly.

export type CategoryKey =
  | "cms"
  | "crm"
  | "ecommerce"
  | "analytics"
  | "marketing"
  | "frameworks"
  | "hosting"
  | "chat"
  | "scheduler"
  | "ads"
  | "other";

// A single compiled detection pattern. `prefilter` is a cheap lowercase literal
// substring that must be present in the target before the (expensive) regex is
// run — this is the main lever for staying under the Workers 10ms CPU budget.
export interface CompiledPattern {
  re: RegExp;
  // Any-of lowercase literal gate: if set, the regex only runs when at least one
  // of these substrings is present in the (lowercased) target. Absent means the
  // pattern can't be safely gated and always runs its regex.
  prefilters?: string[];
  // Parallel to `prefilters`: a 3-gram hash of each literal's first 3 chars, used
  // for an O(1) membership test against the target's precomputed gram set before
  // any (O(n)) substring scan. Built by compilePattern.
  gramKeys?: number[];
  confidence: number; // 0-100, default 100
  version?: string; // version template, e.g. "\\1" backref or a literal like "6"
  key?: string; // for headers/meta/cookies: the (lowercased) name to look up
}

export interface Technology {
  name: string;
  cats: CategoryKey[];
  patterns: {
    html?: CompiledPattern[];
    scriptSrc?: CompiledPattern[];
    scripts?: CompiledPattern[]; // matched against fetched JS bodies
    meta?: CompiledPattern[]; // key = meta name
    headers?: CompiledPattern[]; // key = header name (lowercased)
    cookies?: CompiledPattern[]; // key = cookie name
    url?: CompiledPattern[]; // matched against final URL
  };
  implies?: string[];
  requires?: string[];
  excludes?: string[];
}

// Output of the fetch stage — everything the matcher needs, runtime-agnostic.
export interface FetchedDoc {
  requestedDomain: string;
  finalUrl: string;
  fetchStatus: "ok" | "partial" | "error";
  httpStatus?: number;
  html: string;
  headers: Record<string, string>; // lowercased keys; multi-values joined with ", "
  cookies: { name: string; value: string }[];
  scriptSrcs: string[];
  metas: { name: string; content: string }[]; // name lowercased
  scripts: string[]; // fetched JS bodies (capped)
  error?: string;
}

export interface Detected {
  name: string;
  categories: string[]; // human-readable category labels
  confidence: number;
  version?: string;
}

export type Status = "ok" | "partial" | "error";

// Final envelope returned to Clay. Per-category arrays + *_primary scalars map
// cleanly to Clay columns; `all` carries full detail.
export interface DetectResult {
  domain: string;
  final_url: string;
  status: Status;
  http_status: number | null; // HTTP status of the fetched page (null if no response)
  fetched_at: string;
  cms: string[];
  cms_primary: string | null;
  crm: string[];
  crm_primary: string | null;
  ecommerce: string[];
  analytics: string[];
  marketing: string[];
  frameworks: string[];
  hosting: string[];
  chat: string[];
  ads: string[];
  scheduler: string[];
  all: Detected[];
  error: string | null;
}
