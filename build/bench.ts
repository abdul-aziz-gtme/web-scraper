// Measures pure match+resolve CPU (no network) against the Workers 10ms budget.
// Fetches a few pages once, then times the matching hot path over many iterations.
//   npm run bench  (add to package.json) or: npx tsx build/bench.ts

import { fetchDoc } from "../src/core/fetchDoc.js";
import { fetchAssets } from "../src/core/fetchAssets.js";
import { matchTechnologies } from "../src/core/match.js";
import { resolve } from "../src/core/resolve.js";
import { CURATED } from "../src/core/curated.js";
import { GENERATED } from "../src/core/fingerprints.generated.js";

const ALL = [...CURATED, ...GENERATED];
const DOMAINS = ["wordpress.org", "hubspot.com", "vercel.com", "shopify.com"];
const ITER = 200;

async function main() {
  console.log(`Fingerprints loaded: ${ALL.length}`);
  const withAssets = process.argv.includes("--assets");
  for (const d of DOMAINS) {
    const doc = await fetchDoc(d);
    if (withAssets && doc.scriptSrcs.length)
      doc.scripts = await fetchAssets(doc.scriptSrcs, doc.finalUrl);
    // warm
    for (let i = 0; i < 20; i++) resolve(ALL, matchTechnologies(ALL, doc));
    const t0 = performance.now();
    for (let i = 0; i < ITER; i++) resolve(ALL, matchTechnologies(ALL, doc));
    const per = (performance.now() - t0) / ITER;
    console.log(
      `  ${d.padEnd(16)} html=${(doc.html.length / 1024).toFixed(0)}KB ` +
        `js=${(doc.scripts.join("").length / 1024).toFixed(0)}KB ` +
        `match+resolve = ${per.toFixed(2)} ms`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
