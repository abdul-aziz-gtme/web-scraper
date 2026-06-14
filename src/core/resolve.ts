// Post-processing: turn raw pattern hits into a final technology list by applying
// the webappanalyzer relation semantics — implies (add inferred tech), requires
// (drop tech whose prerequisite is absent), excludes (remove conflicting tech).

import type { CategoryKey, Technology } from "./types.js";
import type { RawHit } from "./match.js";

export interface ResolvedTech {
  name: string;
  cats: CategoryKey[];
  confidence: number;
  version?: string;
}

const MIN_CONFIDENCE = 25;
const MAX_ITERATIONS = 5;

export function resolve(
  techs: Technology[],
  hits: Map<string, RawHit>,
): ResolvedTech[] {
  const registry = new Map<string, Technology>();
  for (const t of techs) registry.set(t.name, t);

  // Work on a mutable copy of the hit set.
  const detected = new Map<string, RawHit>();
  for (const [name, hit] of hits) detected.set(name, { ...hit });

  // Apply implies repeatedly until no new tech appears (capped).
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    let added = false;
    for (const name of [...detected.keys()]) {
      const tech = registry.get(name);
      if (!tech?.implies) continue;
      for (const impliedName of tech.implies) {
        if (detected.has(impliedName)) continue;
        const impliedTech = registry.get(impliedName);
        const cats = impliedTech?.cats ?? ["other"];
        // Inferred tech inherits a slightly reduced confidence.
        const conf = Math.max(MIN_CONFIDENCE, (detected.get(name)!.confidence) - 10);
        detected.set(impliedName, { cats, confidence: conf });
        added = true;
      }
    }
    if (!added) break;
  }

  // Apply excludes.
  for (const name of [...detected.keys()]) {
    const tech = registry.get(name);
    if (!tech?.excludes) continue;
    for (const ex of tech.excludes) detected.delete(ex);
  }

  // Apply requires (drop tech whose prerequisite isn't detected).
  for (const name of [...detected.keys()]) {
    const tech = registry.get(name);
    if (!tech?.requires) continue;
    if (!tech.requires.every((r) => detected.has(r))) detected.delete(name);
  }

  const out: ResolvedTech[] = [];
  for (const [name, hit] of detected) {
    if (hit.confidence < MIN_CONFIDENCE) continue;
    const r: ResolvedTech = {
      name,
      cats: hit.cats,
      confidence: Math.min(100, hit.confidence),
    };
    if (hit.version) r.version = hit.version;
    out.push(r);
  }
  // Highest-confidence first for stable, useful ordering.
  out.sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));
  return out;
}
