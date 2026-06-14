// Orchestrator: domain -> fetch homepage -> (optionally) fetch key JS bundles ->
// match curated + generated fingerprints -> resolve relations -> categorize.
// Shared verbatim by the CLI and the Worker so detection logic never diverges.

import { fetchDoc } from "./fetchDoc.js";
import { fetchAssets } from "./fetchAssets.js";
import { matchTechnologies } from "./match.js";
import { resolve } from "./resolve.js";
import { categorize } from "./categorize.js";
import { CURATED } from "./curated.js";
import { GENERATED } from "./fingerprints.generated.js";
import type { DetectResult, Technology } from "./types.js";

const ALL_TECHS: Technology[] = [...CURATED, ...GENERATED];

export interface DetectOptions {
  // Fetch a few first-party JS bundles and match their CONTENTS. Off by default:
  // the curated + DB fingerprints detect tools from their script *URLs*
  // (scriptSrc), so reading bundle bodies adds latency + subrequests for little
  // CMS/CRM gain. Left as an opt-in for when deeper JS-body signals are wanted
  // (requires adding `scripts` patterns to consume them).
  fetchAssets?: boolean;
  fetchedAt?: string; // override timestamp (testing)
  timeoutMs?: number;
}

export async function detect(
  domain: string,
  opts: DetectOptions = {},
): Promise<DetectResult> {
  const fetchedAt = opts.fetchedAt ?? new Date().toISOString();
  const wantAssets = opts.fetchAssets ?? false;

  const doc = await fetchDoc(domain, { timeoutMs: opts.timeoutMs });

  if (doc.fetchStatus === "error") {
    return categorize(
      domain,
      doc.finalUrl,
      "error",
      [],
      doc.error ?? "fetch failed",
      fetchedAt,
    );
  }

  if (wantAssets && doc.scriptSrcs.length > 0) {
    try {
      doc.scripts = await fetchAssets(doc.scriptSrcs, doc.finalUrl);
    } catch {
      doc.scripts = []; // asset fetch is best-effort; never fail the whole call
    }
  }

  const hits = matchTechnologies(ALL_TECHS, doc);
  const techs = resolve(ALL_TECHS, hits);

  return categorize(
    domain,
    doc.finalUrl,
    doc.fetchStatus,
    techs,
    null,
    fetchedAt,
  );
}
