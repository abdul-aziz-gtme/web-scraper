# Tech-Stack / HubSpot Detection API

A free HTTP API that, given a company domain, fetches its homepage and detects the
tools in its stack — **including whether the site runs HubSpot** (CRM, CMS Hub, and
marketing tracking) — and returns JSON. Built for cold-outbound enrichment (e.g.
Clay's *HTTP API* step), but usable from anything that can make a GET request.

- **Runtime:** TypeScript on **Vercel Functions** (Node 20 serverless).
- **Detection engine:** `src/core/` — identical to the Cloudflare Worker build, so
  results match across both hosts.
- **Cost:** $0 on Vercel's Hobby tier. No paid APIs.

---

## Deploying to Vercel

### Option A — CLI (fastest)

```bash
npm install -g vercel        # or use: npx vercel
vercel login                 # one-time, free account

# from the project root:
vercel                       # creates the project + a preview deployment
vercel deploy --prod         # promote to production  (= npm run deploy:vercel)
```

Vercel auto-detects the `api/` directory and `vercel.json`; there is **no build step
to configure**. Your URL will look like `https://<project>.vercel.app`.

### Option B — Git / Dashboard

Push the repo to GitHub/GitLab/Bitbucket, then in the Vercel dashboard:
**Add New → Project → import the repo → Deploy**. No env vars or framework preset
needed. Every push to the default branch redeploys production automatically.

### Local dev (production-accurate Edge runtime)

```bash
npm run dev:vercel           # = vercel dev  → http://localhost:3000
curl "http://localhost:3000/?domain=hubspot.com"
```

> The project keeps both targets: `npm run deploy` still publishes the Cloudflare
> Worker; `npm run deploy:vercel` publishes to Vercel. Same detection core.

---

## Endpoint

Base URL: `https://<project>.vercel.app`

| Method & Path | Purpose |
|---|---|
| `GET /?domain=<domain>` | Detect the stack for a domain (root convenience path). |
| `GET /api?domain=<domain>` | Same, canonical Vercel path. |
| `GET /<domain>` | Domain as the path, e.g. `/hubspot.com`. |
| `GET /health` | Liveness check → `{"ok":true}`. |

### Query parameters

| Param | Required | Description |
|---|---|---|
| `domain` | yes\* | The domain or URL to inspect, e.g. `acme.com` or `https://acme.com`. `https://` is added if missing. |
| `url` | — | Alias for `domain`. |
| `assets` | no | `assets=1` also downloads up to 3 first-party JS bundles and matches their contents. Slower; off by default. |

\* If `domain`/`url` are absent the path is used as the domain (`/acme.com`).
Omitting all three returns a `400` with `{"status":"error", ...}`.

### Status & error model

The API **always returns HTTP 200** (except a missing-param `400`) and carries the
real outcome in the `status` field, so one unreachable domain never fails a batch:

| `status` | Meaning |
|---|---|
| `ok` | Homepage fetched (2xx/3xx); results are complete. |
| `partial` | Reached the site but got a non-happy status (e.g. 403 bot wall / JS challenge). Header-based signals may still be present. |
| `error` | Could not fetch at all (DNS failure, timeout, TLS error). See `error`. |

CORS is open (`access-control-allow-origin: *`), so the API is callable from a
browser, Google Sheets, or a no-code tool without a proxy.

---

## Response schema

```jsonc
{
  "domain":      "hubspot.com",            // echo of the requested input
  "final_url":   "https://www.hubspot.com/", // after redirects
  "status":      "ok",                      // ok | partial | error
  "fetched_at":  "2026-06-14T07:41:49.654Z",// ISO timestamp

  // Per-category arrays (confidence-sorted, de-duplicated):
  "cms":        ["HubSpot CMS", "HubSpot CMS Hub"],
  "cms_primary":"HubSpot CMS",              // first of cms[], or null
  "crm":        ["HubSpot"],
  "crm_primary":"HubSpot",                  // first of crm[], or null
  "ecommerce":  [],
  "analytics":  ["Linkedin Insight Tag"],
  "marketing":  ["HubSpot"],
  "frameworks": [],
  "hosting":    ["Cloudflare"],
  "chat":       [],
  "ads":        [],
  "scheduler":  [],

  // Full detail for every technology found:
  "all": [
    { "name": "HubSpot",     "categories": ["CRM"],  "confidence": 100 },
    { "name": "HubSpot CMS", "categories": ["CMS"],  "confidence": 100, "version": "..." }
  ],

  "error": null                             // string when status="error", else null
}
```

### Field reference

| Field | Type | Notes |
|---|---|---|
| `domain` | string | The value you passed in. |
| `final_url` | string | URL actually fetched after redirects. |
| `status` | `"ok"`\|`"partial"`\|`"error"` | See status model above. |
| `fetched_at` | string (ISO 8601) | When the homepage was fetched. |
| `cms` … `scheduler` | string[] | Tool names in that category. Empty array if none. |
| `cms_primary` / `crm_primary` | string \| null | Highest-confidence name in that category, for easy column mapping. |
| `all` | object[] | `{ name, categories[], confidence (0–100), version? }` per detection. |
| `error` | string \| null | Human-readable failure reason when `status="error"`. |

---

## "Do they use HubSpot?" — the common case

HubSpot surfaces in up to three places. A site is a HubSpot user if **any** are
non-empty:

- `crm` contains `"HubSpot"` — HubSpot CRM / tracking code (`js.hs-scripts.com`).
- `cms` contains `"HubSpot CMS"` / `"HubSpot CMS Hub"` — the site is built on CMS Hub.
- `marketing` contains `"HubSpot"` — HubSpot marketing automation pixels.

A quick boolean in any caller:

```js
const r = await fetch(`https://<project>.vercel.app/?domain=${domain}`).then(x => x.json());
const usesHubSpot =
  r.crm.includes("HubSpot") ||
  r.marketing.includes("HubSpot") ||
  r.cms.some(c => c.startsWith("HubSpot"));
```

---

## Examples

```bash
# Basic
curl "https://<project>.vercel.app/?domain=hubspot.com"

# Domain as path
curl "https://<project>.vercel.app/stripe.com"

# Deep scan (also reads first-party JS bundles)
curl "https://<project>.vercel.app/api?domain=acme.com&assets=1"

# Health
curl "https://<project>.vercel.app/health"     # -> {"ok":true}
```

### Clay setup

Add an **HTTP API** enrichment:

- **Method:** `GET`
- **URL:** `https://<project>.vercel.app/?domain={{Domain}}`
- Map the response fields to columns: `crm_primary`, `cms_primary`, and the
  `crm` / `cms` / `marketing` arrays (for the HubSpot question), plus any of
  `analytics` / `hosting` / `frameworks` you want.

Because every response is HTTP 200, Clay won't error the batch on a dead domain —
filter on `status` instead.

---

## Limits & notes

- **Static fetch only.** Sites behind bot walls or fully JS-rendered challenge pages
  return `status:"partial"` — header/cookie signals may still identify hosting/CDN.
- **No server-side cache.** The function is stateless; dedupe/cache results in your
  caller (Clay, a sheet, your batch driver).
- **Edge runtime.** Per-request CPU is generous on Vercel; the engine matches in
  ~4–8 ms. Wall-clock per domain is ~0.4–1.7 s (a 12 s fetch timeout caps the worst
  case), well under Clay's 30 s step timeout.
- **License:** the bundled webappanalyzer fingerprint DB is GPL-3.0 — fine for a
  private hosted service; don't publicly redistribute the bundle itself.
```
