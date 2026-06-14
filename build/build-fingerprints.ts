// Compiles the vendored webappanalyzer DB into a slim, runtime-ready fingerprint
// module: src/core/fingerprints.generated.ts.
//
// What it does:
//   1. Reads .tmp/webappanalyzer/{categories.json, technologies/*.json}
//   2. Keeps only priority categories (CMS, CRM, ecommerce, analytics, marketing,
//      frameworks, hosting/CDN, chat, scheduler, ads)
//   3. Keeps only statically-evaluable pattern types (html, scriptSrc, scripts,
//      meta, headers, cookies, url) — drops dom/js/css/dns/xhr/probe
//   4. Drops invalid or ReDoS-prone regexes
//   5. Drops names already covered by the hand-curated set
//   6. Emits raw data compiled at load via the shared buildTech()
//
// Run: npm run build:fingerprints   (after npm run fetch:db)

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { looksReDoSProne, derivePrefilters } from "../src/core/compile.js";
import { CURATED } from "../src/core/curated.js";
import type { RawTechData } from "../src/core/buildTech.js";
import type { CategoryKey } from "../src/core/types.js";

const DB_DIR = join(process.cwd(), ".tmp", "webappanalyzer");
const OUT_FILE = join(process.cwd(), "src", "core", "fingerprints.generated.ts");

// Map a webappanalyzer category NAME (read from categories.json, robust to id
// renumbering) to our internal CategoryKey, or null to drop the category.
function mapCategory(name: string): CategoryKey | null {
  const n = name.toLowerCase();
  if (n.includes("crm")) return "crm";
  if (n.includes("marketing automation")) return "marketing";
  if (n.includes("ecommerce") || n.includes("e-commerce")) return "ecommerce";
  if (n.includes("cms") || n === "blogs" || n.includes("static site")) return "cms";
  if (n.includes("analytics")) return "analytics";
  if (n.includes("advertis")) return "ads";
  if (n.includes("live chat")) return "chat";
  if (n.includes("appointment") || n.includes("scheduling")) return "scheduler";
  if (n.includes("framework")) return "frameworks"; // JS / Web / Mobile frameworks
  if (n.includes("cdn") || n.includes("paas") || n.includes("hosting") || n.includes("web servers"))
    return "hosting";
  return null;
}

type AnyVal = string | string[] | Record<string, string | string[]> | undefined;

// For large text targets (html, scripts) we additionally require that every kept
// pattern is gateable (has a safe prefilter) — ungateable patterns would run
// their regex on the full document every request and blow the CPU budget. The
// hand-curated set covers priority recall, so this long-tail trim is safe.
function toList(v: AnyVal, requireGate = false): string[] | undefined {
  if (v == null) return undefined;
  const arr = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
  const kept = arr.filter((raw) => {
    if (!validRaw(raw)) return false;
    if (requireGate) {
      const source = raw.split("\\;")[0] ?? "";
      if (derivePrefilters(source) === null) return false;
    }
    return true;
  });
  return kept.length ? kept : undefined;
}

function toKeyed(v: AnyVal): Record<string, string> | undefined {
  if (v == null || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v)) {
    const first = Array.isArray(val) ? val[0] : val;
    if (typeof first === "string" && validRaw(first)) out[k] = first;
  }
  return Object.keys(out).length ? out : undefined;
}

// A raw pattern is keepable if its regex compiles and isn't ReDoS-prone.
function validRaw(raw: string): boolean {
  const source = raw.split("\\;")[0] ?? "";
  if (looksReDoSProne(source)) return false;
  try {
    new RegExp(source, "i");
    return true;
  } catch {
    return false;
  }
}

function cleanNames(v: unknown, keep: Set<string>): string[] | undefined {
  if (v == null) return undefined;
  const arr = Array.isArray(v) ? v : [v];
  const out: string[] = [];
  for (const item of arr) {
    if (typeof item !== "string") continue;
    const name = item.split("\\;")[0]!.trim();
    if (keep.has(name)) out.push(name);
  }
  return out.length ? out : undefined;
}

async function main() {
  const catsRaw = JSON.parse(
    await readFile(join(DB_DIR, "categories.json"), "utf8"),
  ) as Record<string, { name: string }>;
  const catKey = new Map<number, CategoryKey>();
  for (const [id, c] of Object.entries(catsRaw)) {
    const mapped = mapCategory(c.name);
    if (mapped) catKey.set(Number(id), mapped);
  }

  const curatedNames = new Set(CURATED.map((t) => t.name));

  // First pass: load all techs, decide which to keep (priority category + has a
  // usable pattern + not already curated). Collect kept names so relations can be
  // filtered to in-scope tech.
  const files = "_abcdefghijklmnopqrstuvwxyz".split("");
  const allTechs: Record<string, any> = {};
  for (const f of files) {
    let text: string;
    try {
      text = await readFile(join(DB_DIR, "technologies", `${f}.json`), "utf8");
    } catch {
      continue;
    }
    Object.assign(allTechs, JSON.parse(text));
  }

  const keepNames = new Set<string>();
  for (const [name, def] of Object.entries(allTechs)) {
    if (curatedNames.has(name)) continue;
    const cats: CategoryKey[] = [];
    for (const id of def.cats ?? []) {
      const k = catKey.get(id);
      if (k && !cats.includes(k)) cats.push(k);
    }
    if (cats.length === 0) continue;
    // Must have at least one cheap-target signal (we drop html/scripts; see below).
    if (
      def.scriptSrc == null &&
      def.meta == null &&
      def.headers == null &&
      def.cookies == null &&
      def.url == null
    )
      continue;
    keepNames.add(name);
  }

  const out: RawTechData[] = [];
  for (const name of keepNames) {
    const def = allTechs[name];
    const cats: CategoryKey[] = [];
    for (const id of def.cats ?? []) {
      const k = catKey.get(id);
      if (k && !cats.includes(k)) cats.push(k);
    }
    const entry: RawTechData = { name, cats };
    // NB: we deliberately DO NOT emit html/scripts patterns for the long-tail DB.
    // Their literals are common words ("div", "com", "http") that defeat the
    // prefilter gate, so each would run a regex over the full document every
    // request and blow the 10ms CPU budget. The hand-curated set carries the
    // specific html signals for priority platforms; the DB contributes via the
    // discriminative, cheap targets below (domain/key literals).
    const scriptSrc = toList(def.scriptSrc);
    const url = toList(def.url);
    const meta = toKeyed(def.meta);
    const headers = toKeyed(def.headers);
    const cookies = toKeyed(def.cookies);
    const implies = cleanNames(def.implies, keepNames);
    const requires = cleanNames(def.requires, keepNames);
    const excludes = cleanNames(def.excludes, keepNames);
    if (scriptSrc) entry.scriptSrc = scriptSrc;
    if (url) entry.url = url;
    if (meta) entry.meta = meta;
    if (headers) entry.headers = headers;
    if (cookies) entry.cookies = cookies;
    if (implies) entry.implies = implies;
    if (requires) entry.requires = requires;
    if (excludes) entry.excludes = excludes;

    // Skip if, after pruning, no usable (cheap-target) pattern survived.
    if (!scriptSrc && !url && !meta && !headers && !cookies) continue;
    out.push(entry);
  }

  out.sort((a, b) => a.name.localeCompare(b.name));

  const banner =
    "// AUTO-GENERATED by build/build-fingerprints.ts — do not edit by hand.\n" +
    `// Source: enthec/webappanalyzer (GPL-3.0). ${out.length} technologies, priority categories only.\n`;
  const body =
    banner +
    'import { buildTech, type RawTechData } from "./buildTech.js";\n' +
    'import type { Technology } from "./types.js";\n\n' +
    "// Data is embedded as a JSON string and parsed at module load (a few ms, well\n" +
    "// within the 1s Worker startup budget). This avoids a TS2590 (union type too\n" +
    "// complex) that a giant inline object-literal array would trigger.\n" +
    "const RAW = JSON.parse(\n" +
    JSON.stringify(JSON.stringify(out)) +
    "\n) as RawTechData[];\n\n" +
    "export const GENERATED: Technology[] = RAW.map(buildTech);\n";

  await writeFile(OUT_FILE, body, "utf8");
  const bytes = Buffer.byteLength(body, "utf8");
  console.log(
    `Wrote ${out.length} technologies to ${OUT_FILE} (${(bytes / 1024).toFixed(1)} KB raw)`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
