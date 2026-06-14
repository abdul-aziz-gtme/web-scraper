// Network-free regression tests for the matching pipeline. Each test crafts a
// FetchedDoc fixture and asserts the resolved categories, so changes to curated
// or generated fingerprints can't silently break priority CMS/CRM detection.
//
//   npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { matchTechnologies } from "./match.js";
import { resolve } from "./resolve.js";
import { categorize } from "./categorize.js";
import { CURATED } from "./curated.js";
import { GENERATED } from "./fingerprints.generated.js";
import type { FetchedDoc } from "./types.js";

const ALL = [...CURATED, ...GENERATED];

function doc(partial: Partial<FetchedDoc>): FetchedDoc {
  return {
    requestedDomain: "example.com",
    finalUrl: "https://example.com/",
    fetchStatus: "ok",
    html: "",
    headers: {},
    cookies: [],
    scriptSrcs: [],
    metas: [],
    scripts: [],
    ...partial,
  };
}

function run(d: FetchedDoc) {
  return categorize("example.com", d.finalUrl, d.fetchStatus, resolve(ALL, matchTechnologies(ALL, d)), null, "t");
}

test("WordPress via html + meta generator", () => {
  const r = run(
    doc({
      html: '<link href="/wp-content/themes/x/style.css"><meta name="generator" content="WordPress 6.5">',
      metas: [{ name: "generator", content: "WordPress 6.5" }],
    }),
  );
  assert.ok(r.cms.includes("WordPress"));
  assert.equal(r.cms_primary, "WordPress");
  assert.equal(r.all.find((t) => t.name === "WordPress")?.version, "6.5");
});

test("HubSpot CRM via tracking script", () => {
  const r = run(
    doc({ scriptSrcs: ["https://js.hs-scripts.com/123456.js"] }),
  );
  assert.ok(r.crm.includes("HubSpot"));
});

test("Shopify via script CDN + header", () => {
  const r = run(
    doc({
      scriptSrcs: ["https://cdn.shopify.com/s/files/app.js"],
      headers: { "x-shopify-stage": "production" },
    }),
  );
  assert.ok(r.cms.includes("Shopify"));
  assert.ok(r.ecommerce.includes("Shopify"));
});

test("Framer via meta generator", () => {
  const r = run(doc({ metas: [{ name: "generator", content: "Framer" }] }));
  assert.ok(r.cms.includes("Framer"));
});

test("Salesforce Web-to-Lead (real form action, not brand text)", () => {
  const r = run(
    doc({ html: 'form action="https://webto.salesforce.com/servlet/servlet.WebToLead"' }),
  );
  assert.ok(r.crm.includes("Salesforce"));
});

test("brand name in marketing copy does NOT false-positive (BigCommerce)", () => {
  const r = run(doc({ html: "<p>We compared BigCommerce vs our platform.</p>" }));
  assert.ok(!r.ecommerce.includes("BigCommerce"));
});

test("Next.js implies React", () => {
  const r = run(doc({ html: '<script src="/_next/static/chunks/main.js"></script>' }));
  assert.ok(r.frameworks.includes("Next.js"));
  assert.ok(r.frameworks.includes("React"));
});

test("fetch error yields status error and empty detections", () => {
  const r = categorize("example.com", "https://example.com/", "error", [], "boom", "t");
  assert.equal(r.status, "error");
  assert.equal(r.error, "boom");
  assert.equal(r.all.length, 0);
});
