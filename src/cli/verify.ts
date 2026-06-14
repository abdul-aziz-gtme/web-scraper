// Local single-domain verification (Stage 1). Runs the exact same core the Worker
// uses, against a real domain, and pretty-prints the result.
//
//   npm run verify -- example.com
//   npm run verify -- example.com --json
//   npm run verify -- example.com --assets   (also fetch JS bundles)

import { detect } from "../core/detect.js";

async function main() {
  const args = process.argv.slice(2);
  const domain = args.find((a) => !a.startsWith("--"));
  const asJson = args.includes("--json");
  const assets = args.includes("--assets");

  if (!domain) {
    console.error("Usage: npm run verify -- <domain> [--json] [--assets]");
    process.exit(1);
  }

  const started = Date.now();
  const result = await detect(domain, { fetchAssets: assets });
  const elapsed = Date.now() - started;

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const line = (label: string, vals: string[]) =>
    vals.length ? `  ${label.padEnd(14)} ${vals.join(", ")}` : "";

  console.log(`\n  ${result.domain}  →  ${result.final_url}`);
  console.log(`  status: ${result.status}  (${elapsed}ms)`);
  if (result.error) console.log(`  error: ${result.error}`);
  console.log("");
  const sections = [
    line("CMS", result.cms),
    line("CRM", result.crm),
    line("E-commerce", result.ecommerce),
    line("Marketing", result.marketing),
    line("Analytics", result.analytics),
    line("Ads", result.ads),
    line("Frameworks", result.frameworks),
    line("Hosting/CDN", result.hosting),
    line("Chat", result.chat),
    line("Scheduler", result.scheduler),
  ].filter(Boolean);
  console.log(sections.join("\n") || "  (no technologies detected)");
  console.log(`\n  ${result.all.length} technologies total\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
