// Shapes the resolved technology list into the flat-ish Clay envelope: one array
// per category + a *_primary scalar for the two the user filters on most
// (CMS, CRM), plus a full `all` list.

import type { CategoryKey, DetectResult, Detected, Status } from "./types.js";
import type { ResolvedTech } from "./resolve.js";

const CATEGORY_LABELS: Record<CategoryKey, string> = {
  cms: "CMS",
  crm: "CRM",
  ecommerce: "E-commerce",
  analytics: "Analytics",
  marketing: "Marketing Automation",
  frameworks: "Web Framework",
  hosting: "Hosting / CDN",
  chat: "Live Chat",
  scheduler: "Scheduler",
  ads: "Advertising",
  other: "Other",
};

function labelsFor(cats: CategoryKey[]): string[] {
  return cats.map((c) => CATEGORY_LABELS[c]);
}

// De-duplicated names in a category, preserving the (confidence-sorted) order.
function namesInCategory(techs: ResolvedTech[], cat: CategoryKey): string[] {
  const out: string[] = [];
  for (const t of techs) {
    if (t.cats.includes(cat) && !out.includes(t.name)) out.push(t.name);
  }
  return out;
}

export function categorize(
  domain: string,
  finalUrl: string,
  status: Status,
  techs: ResolvedTech[],
  error: string | null,
  fetchedAt: string,
  httpStatus: number | null = null,
): DetectResult {
  const all: Detected[] = techs.map((t) => {
    const d: Detected = {
      name: t.name,
      categories: labelsFor(t.cats),
      confidence: t.confidence,
    };
    if (t.version) d.version = t.version;
    return d;
  });

  const cms = namesInCategory(techs, "cms");
  const crm = namesInCategory(techs, "crm");

  return {
    domain,
    final_url: finalUrl,
    status,
    http_status: httpStatus,
    fetched_at: fetchedAt,
    cms,
    cms_primary: cms[0] ?? null,
    crm,
    crm_primary: crm[0] ?? null,
    ecommerce: namesInCategory(techs, "ecommerce"),
    analytics: namesInCategory(techs, "analytics"),
    marketing: namesInCategory(techs, "marketing"),
    frameworks: namesInCategory(techs, "frameworks"),
    hosting: namesInCategory(techs, "hosting"),
    chat: namesInCategory(techs, "chat"),
    ads: namesInCategory(techs, "ads"),
    scheduler: namesInCategory(techs, "scheduler"),
    all,
    error,
  };
}
