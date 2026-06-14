// Diagnostic: per-section CPU breakdown of matchTechnologies with the current DB.

import { fetchDoc } from "../src/core/fetchDoc.js";
import { fetchAssets } from "../src/core/fetchAssets.js";
import { CURATED } from "../src/core/curated.js";
import { GENERATED } from "../src/core/fingerprints.generated.js";
import { gram3 } from "../src/core/compile.js";
import type { CompiledPattern } from "../src/core/types.js";

const ALL = [...CURATED, ...GENERATED];
const GRAM_BITS = 1 << 20;
const GRAM_MASK = GRAM_BITS - 1;

function buildBits(lower: string): Uint8Array {
  const bits = new Uint8Array(GRAM_BITS >> 3);
  for (let i = 0; i + 2 < lower.length; i++) {
    const idx = (gram3(lower, i) >>> 0) & GRAM_MASK;
    bits[idx >> 3]! |= 1 << (idx & 7);
  }
  return bits;
}

function runLoop(pats: { p: CompiledPattern }[], lower: string, raw: string, bits: Uint8Array) {
  let exec = 0;
  for (const { p } of pats) {
    if (p.gramKeys) {
      let cand = false;
      for (let i = 0; i < p.gramKeys.length; i++) {
        const idx = (p.gramKeys[i]! >>> 0) & GRAM_MASK;
        if ((bits[idx >> 3]! & (1 << (idx & 7))) !== 0 && lower.includes(p.prefilters![i]!)) {
          cand = true;
          break;
        }
      }
      if (!cand) continue;
    }
    p.re.exec(raw);
    exec++;
  }
  return exec;
}

async function main() {
  const doc = await fetchDoc("vercel.com");
  if (doc.scriptSrcs.length) doc.scripts = await fetchAssets(doc.scriptSrcs, doc.finalUrl);

  const htmlRaw = doc.html.slice(0, 200 * 1024);
  const htmlLower = htmlRaw.toLowerCase();
  const ssRaw = doc.scriptSrcs.join("\n").slice(0, 48 * 1024);
  const ssLower = ssRaw.toLowerCase();

  const htmlPats = ALL.flatMap((t) => (t.patterns.html ?? []).map((p) => ({ p })));
  const ssPats = ALL.flatMap((t) => (t.patterns.scriptSrc ?? []).map((p) => ({ p })));

  const N = 300;
  let t0 = performance.now();
  for (let r = 0; r < N; r++) buildBits(htmlLower);
  console.log(`bitmap build html(${(htmlLower.length/1024)|0}KB) = ${((performance.now()-t0)/N).toFixed(2)}ms`);

  const htmlBits = buildBits(htmlLower);
  const ssBits = buildBits(ssLower);

  t0 = performance.now();
  let e = 0;
  for (let r = 0; r < N; r++) e = runLoop(htmlPats, htmlLower, htmlRaw, htmlBits);
  console.log(`html loop (${htmlPats.length} pats, ${e} regex exec) = ${((performance.now()-t0)/N).toFixed(2)}ms`);

  t0 = performance.now();
  for (let r = 0; r < N; r++) e = runLoop(ssPats, ssLower, ssRaw, ssBits);
  console.log(`scriptSrc loop (${ssPats.length} pats, ${e} regex exec) = ${((performance.now()-t0)/N).toFixed(2)}ms`);
}

main();
