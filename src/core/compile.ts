// Compiles raw Wappalyzer-style pattern strings into runtime CompiledPatterns.
//
// A raw pattern looks like:   foo\;version:\1\;confidence:50
// i.e. a regex, optionally followed by \;-separated tags (version, confidence).
//
// The performance-critical piece is the "prefilter": a set of cheap lowercase
// literal substrings used to gate the (expensive) regex at match time. The gate
// is ANY-OF and SAFE — for an alternation like `a|b|c` we derive one literal per
// branch, so a match on any branch is never gated away (no false negatives). If
// any branch has no usable literal, we return null (the pattern can't be safely
// gated and must run its regex unconditionally).

import type { CompiledPattern } from "./types.js";

// 3-gram hash of the chars at positions i..i+2 of a string. Shared by the
// matcher (to build the per-target gram set) and compilePattern (to key each
// prefilter). Collisions are harmless — they only cause an extra includes()
// verify, never a missed match.
export function gram3(s: string, i: number): number {
  return ((s.charCodeAt(i) * 31 + s.charCodeAt(i + 1)) * 31 + s.charCodeAt(i + 2)) | 0;
}

// Split a regex source on top-level (depth-0, unescaped) `|`.
function splitTopLevelAlternation(source: string): string[] {
  const branches: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (c === "\\") {
      cur += c + (source[i + 1] ?? "");
      i++;
      continue;
    }
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth = Math.max(0, depth - 1);
    if (c === "|" && depth === 0) {
      branches.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  branches.push(cur);
  return branches;
}

// Longest run of literal lowercase alphanumeric chars in a branch (no top-level
// alternation), skipping escapes and dropping chars made optional by ? * {.
function deriveLiteral(src: string): string {
  let best = "";
  let cur = "";
  const flush = () => {
    if (cur.length > best.length) best = cur;
    cur = "";
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (c === "\\") {
      i++; // escaped char is a boundary (\. \/ \d ...)
      flush();
      continue;
    }
    const next = src[i + 1];
    const optionalNext = next === "?" || next === "*" || next === "{";
    if (/[a-zA-Z0-9]/.test(c) && !optionalNext) {
      cur += c.toLowerCase();
    } else {
      flush();
      if (optionalNext) i++;
    }
  }
  flush();
  return best;
}

// Returns an any-of prefilter set, or null if the pattern can't be safely gated.
export function derivePrefilters(source: string): string[] | null {
  const branches = splitTopLevelAlternation(source);
  const lits: string[] = [];
  for (const b of branches) {
    const lit = deriveLiteral(b);
    if (lit.length < 3) return null; // a branch with no literal → cannot gate
    lits.push(lit);
  }
  // De-dup.
  return [...new Set(lits)];
}

export function compilePattern(
  raw: string,
  key?: string,
): CompiledPattern | null {
  const parts = raw.split("\\;");
  const source = parts[0] ?? "";
  let confidence = 100;
  let version: string | undefined;
  for (let i = 1; i < parts.length; i++) {
    const tag = parts[i]!;
    if (tag.startsWith("confidence:")) {
      const n = parseInt(tag.slice("confidence:".length), 10);
      if (!Number.isNaN(n)) confidence = n;
    } else if (tag.startsWith("version:")) {
      version = tag.slice("version:".length);
    }
  }
  let re: RegExp;
  try {
    re = new RegExp(source, "i");
  } catch {
    return null; // skip invalid regex rather than crash the build/runtime
  }
  const pat: CompiledPattern = { re, confidence };
  if (version) pat.version = version;
  if (key) pat.key = key.toLowerCase();
  const pf = derivePrefilters(source);
  if (pf) {
    pat.prefilters = pf;
    pat.gramKeys = pf.map((lit) => gram3(lit, 0));
  }
  return pat;
}

// Reject patterns whose source looks ReDoS-prone (nested unbounded quantifiers).
export function looksReDoSProne(source: string): boolean {
  return /\([^)]*[+*][^)]*\)[+*{]/.test(source);
}
