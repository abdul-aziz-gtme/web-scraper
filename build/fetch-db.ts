// Vendors the open-source webappanalyzer fingerprint DB (the community fork of
// Wappalyzer's technologies, GPL-3.0) into .tmp/ for the build step to consume.
// Run: npm run fetch:db
//
// .tmp/ is disposable per the WAT conventions — re-run weekly to track upstream.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const BASE =
  "https://raw.githubusercontent.com/enthec/webappanalyzer/main/src";
const OUT_DIR = join(process.cwd(), ".tmp", "webappanalyzer");

const FILES = [
  "categories.json",
  ..."_abcdefghijklmnopqrstuvwxyz".split("").map((c) => `technologies/${c}.json`),
];

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "techstack-detector build" },
    });
    if (!res.ok) {
      console.warn(`  ! ${url} -> HTTP ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (e) {
    console.warn(`  ! ${url} -> ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

async function main() {
  await mkdir(join(OUT_DIR, "technologies"), { recursive: true });
  let ok = 0;
  for (const f of FILES) {
    const text = await fetchText(`${BASE}/${f}`);
    if (text === null) continue;
    await writeFile(join(OUT_DIR, f), text, "utf8");
    ok++;
  }
  console.log(`Fetched ${ok}/${FILES.length} files into ${OUT_DIR}`);
  if (ok < FILES.length) {
    console.warn("Some files failed; build will use whatever was fetched.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
