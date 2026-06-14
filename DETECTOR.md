# Tech-Stack Detector

A **completely free** tech-stack detection API. Given a company domain it detects the
CMS, CRM, and the rest of the stack (analytics, ad pixels, marketing automation,
hosting/CDN, frameworks, e-commerce, chat, schedulers) from a static fetch, and returns
JSON. Built for cold-outbound enrichment via **Clay** (HTTP API request step).

- **Runtime:** TypeScript, one codebase for local CLI + hosted Worker.
- **Host:** Cloudflare Workers free tier (zero cold start, 100k req/day, global edge).
- **Cost:** $0. No paid APIs, services, or deployment.

## How it works

1. Fetch the homepage (browser UA, follows redirects, body capped) → HTML, response
   headers, cookies, `<script src>` URLs, `<meta>` tags.
2. Match against two fingerprint sets:
   - **Curated** (`src/core/curated.ts`) — hand-written, high-confidence rules for the
     ~50 platforms that matter most (WordPress, Webflow, Framer, Shopify, Squarespace,
     Wix, HubSpot, Ghost, Hugo…; HubSpot/Salesforce/Pardot/Marketo/Pipedrive/Zoho CRM;
     GA4/GTM/Meta/LinkedIn; Cloudflare/Vercel/Netlify; Next/React/Vue…). Guarantees recall
     on the priority CMS/CRM signals.
   - **Generated** (`src/core/fingerprints.generated.ts`) — the open-source
     [enthec/webappanalyzer](https://github.com/enthec/webappanalyzer) DB (GPL-3.0),
     pruned at build time to priority categories and **cheap, discriminative pattern
     types only** (scriptSrc, headers, meta, cookies, url). ~2,600 technologies.
3. Resolve `implies`/`requires`/`excludes`, categorize, return JSON.

**Performance:** match+resolve runs in ~4–8 ms CPU (the Workers free limit is **10 ms
CPU/request**). Total wall-clock per domain is ~0.4–1.7 s, far under Clay's 30 s timeout.
The speed comes from a per-document 3-gram **bitmap prefilter** so only a handful of
regexes actually execute (see `src/core/match.ts`).

## Local use (Stage 1 — verify detection)

```bash
npm install
npm run verify -- shopify.com            # pretty output
npm run verify -- hubspot.com --json     # full JSON
npm run verify -- acme.com --assets      # also fetch JS bundles (opt-in; see note)
```

## Hosted API (Stage 2 — Clay)

```bash
npm run dev                              # local Worker (production-accurate runtime)
# then: curl "http://127.0.0.1:8787/?domain=acme.com"

npx wrangler login                       # one-time, free Cloudflare account
npm run deploy                           # publishes to https://techstack-detector.<you>.workers.dev
```

**Endpoint:**
```
GET /?domain=acme.com          -> tech-stack JSON
GET /?domain=acme.com&assets=1 -> also fetch JS bundles (slower; see note)
GET /health                    -> {"ok":true}
```
Always returns **HTTP 200** with a `status` field (`ok` | `partial` | `error`) so one bad
domain never errors Clay's batch step.

**Clay setup:** add an *HTTP API* enrichment, `GET` to
`https://techstack-detector.<you>.workers.dev/?domain={{Domain}}`, then map
`cms_primary`, `crm_primary`, and the `cms`/`crm`/`analytics`/… arrays to columns.

## Updating fingerprints

```bash
npm run fetch:db            # download latest webappanalyzer DB into .tmp/ (free)
npm run build:fingerprints  # prune + compile -> src/core/fingerprints.generated.ts
```
Re-run periodically (e.g. weekly) to track upstream. Curated rules are edited by hand in
`src/core/curated.ts`.

## Notes & trade-offs

- **JS-body fetching is off by default.** Tools are already identified by their script
  *URLs* (`scriptSrc`), so reading bundle *contents* adds latency + subrequests for little
  CMS/CRM gain. The capability remains (`?assets=1` / `--assets`); to make it contribute,
  add `scripts` patterns in `curated.ts`.
- **Known false-negative class:** sites behind bot walls / full JS-rendered challenge
  pages (Cloudflare/Akamai) can't be read by a static fetch — these return
  `status:"partial"`. A realistic browser UA minimizes 403s.
- **Caching is client-side.** Workers KV's free tier allows only 1,000 writes/day, so the
  Worker is stateless; dedupe/cache results in Clay or your batch driver.
- **Free fallback:** if the 10 ms CPU limit is ever exceeded on real traffic, the
  runtime-agnostic core in `src/core/` runs unchanged on **Deno Deploy** (more generous
  free per-request CPU) with a thin entry file. Free stays intact.
- **License:** the bundled webappanalyzer data is GPL-3.0 — fine for a private hosted
  service (GPL has no network-use clause); just don't publicly redistribute the bundle.

## Layout

```
src/core/      detection engine (runtime-agnostic): fetch, extract, match, resolve, categorize
src/cli/       local single-domain verify CLI
src/worker/    Cloudflare Worker HTTP entry
build/         DB fetch, fingerprint compiler, bench/diag tools
.tmp/          vendored webappanalyzer DB (disposable, re-fetchable)
```
