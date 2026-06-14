# Workflow: Scrape a Website

## Objective
Pull structured data from one or more web pages and hand back a clean, usable
result (JSON or extracted text). This is the canonical "fetch data from a site"
SOP for the project.

## Required Inputs
- **URL** (required): full URL including scheme, e.g. `https://example.com`.
- **CSS selector** (optional): when the user wants specific elements rather than
  the whole page. Example: `.titleline > a` for Hacker News story links.
- **Attribute** (optional): when extracting an attribute instead of text, e.g.
  `href` from `<a>` tags. Only meaningful alongside a selector.
- **Output location** (optional): defaults to stdout; pass `--out .tmp/<name>.json`
  to persist an intermediate file.

## Tool To Use
`tools/scrape_single_site.py` — does the fetch + parse deterministically.

```bash
# Whole-page metadata, links, and visible text:
python tools/scrape_single_site.py <url> --out .tmp/result.json

# Targeted extraction by CSS selector:
python tools/scrape_single_site.py <url> --selector "<css>" --out .tmp/items.json

# Extract an attribute (e.g. all link hrefs):
python tools/scrape_single_site.py <url> --selector "a" --attr href
```

## Expected Output
A JSON object containing:
- `url`, `status_code`, `scraped_at` (UTC ISO timestamp)
- `data`: either page-level fields (`title`, `meta_description`, `links`, `text`)
  or selector results (`selector`, `count`, `items`).

Intermediates land in `.tmp/`. Final deliverables the user needs to see should be
pushed to a cloud service (e.g. Google Sheets) per the project's core principle.

## Steps
1. Confirm you have a valid URL. If missing or malformed, ask the user.
2. Decide whether the task needs the whole page or a targeted selector. If the
   user described specific data ("all the headlines"), prefer a selector; you may
   need to inspect the page structure first (a whole-page scrape can reveal it).
3. Run `tools/scrape_single_site.py` with the right flags.
4. Validate the result: non-zero `count` / non-empty `text`. If empty, the
   selector is likely wrong or the content is JS-rendered (see Edge Cases).
5. Persist intermediates to `.tmp/`; deliver final output where the user wants it.

## Edge Cases & Learnings
- **HTTP errors (exit 2):** check the status — 403/429 often means the site
  blocks bots or rate-limits. Try a different User-Agent (`SCRAPER_USER_AGENT` in
  `.env`) and add a delay (`SCRAPER_REQUEST_DELAY`).
- **Empty results with a valid selector:** the content is probably rendered by
  JavaScript. `requests` only sees the initial HTML. Escalate to a headless
  browser (e.g. Playwright) — add a new tool rather than overloading this one.
- **Politeness:** set `SCRAPER_REQUEST_DELAY` and respect each site's
  `robots.txt` and Terms of Service. Don't hammer endpoints.
- **Multiple pages:** loop the tool per URL from the agent layer; keep the tool
  single-purpose.

<!-- Update this section as you learn new constraints, rate limits, or quirks. -->
