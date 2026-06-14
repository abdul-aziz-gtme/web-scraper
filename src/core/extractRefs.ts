// Pulls the cheap, high-signal references out of raw HTML without a DOM parser
// (Workers has no DOMParser by default, and regex extraction keeps CPU low):
//   - <script src="..."> URLs (resolved to absolute)
//   - <meta name=... content=...> pairs (esp. generator)
// These feed scriptSrc / meta fingerprint matching.

export interface Refs {
  scriptSrcs: string[];
  metas: { name: string; content: string }[];
}

const SCRIPT_SRC_RE = /<script\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
const META_RE = /<meta\b[^>]*>/gi;
const ATTR_RE = (name: string) =>
  new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i");

const MAX_SCRIPTS = 200; // guardrail against pathological pages

function resolveUrl(src: string, baseUrl: string): string {
  try {
    return new URL(src, baseUrl).href;
  } catch {
    return src;
  }
}

export function extractRefs(html: string, baseUrl: string): Refs {
  const scriptSrcs: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  SCRIPT_SRC_RE.lastIndex = 0;
  while ((m = SCRIPT_SRC_RE.exec(html)) !== null) {
    const abs = resolveUrl(m[1]!, baseUrl);
    if (!seen.has(abs)) {
      seen.add(abs);
      scriptSrcs.push(abs);
      if (scriptSrcs.length >= MAX_SCRIPTS) break;
    }
  }

  const metas: { name: string; content: string }[] = [];
  const nameAttr = ATTR_RE("name");
  const propAttr = ATTR_RE("property");
  const contentAttr = ATTR_RE("content");
  META_RE.lastIndex = 0;
  while ((m = META_RE.exec(html)) !== null) {
    const tag = m[0];
    const nameMatch = nameAttr.exec(tag) ?? propAttr.exec(tag);
    const contentMatch = contentAttr.exec(tag);
    if (nameMatch && contentMatch) {
      metas.push({
        name: nameMatch[1]!.toLowerCase(),
        content: contentMatch[1]!,
      });
    }
  }

  return { scriptSrcs, metas };
}
