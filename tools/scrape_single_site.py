#!/usr/bin/env python3
"""Scrape a single web page and emit structured JSON.

WAT framework Tool (Layer 3). Deterministic execution — no AI reasoning here.
The agent decides *when* and *with what inputs* to run this; the script just does
the fetch + parse reliably.

Usage:
    python tools/scrape_single_site.py <url> [--selector CSS] [--out PATH]
                                            [--attr ATTR] [--format json|text]

Examples:
    # Dump page title, meta description, links, and visible text to .tmp/
    python tools/scrape_single_site.py https://example.com

    # Extract every matching element's text using a CSS selector
    python tools/scrape_single_site.py https://news.ycombinator.com \\
        --selector ".titleline > a" --out .tmp/hn_titles.json

    # Extract an attribute (e.g. href) instead of text
    python tools/scrape_single_site.py https://example.com \\
        --selector "a" --attr href

Exit codes:
    0  success
    1  usage / argument error
    2  network / HTTP error
    3  parse error
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError as exc:  # pragma: no cover - dependency guard
    sys.stderr.write(
        f"Missing dependency: {exc.name}. Run: pip install -r requirements.txt\n"
    )
    sys.exit(1)

# Load .env if python-dotenv is available; otherwise fall back to os.environ.
try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass


DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (compatible; WAT-Scraper/1.0; +https://example.com/bot)"
)


def fetch(url: str, timeout: float, user_agent: str) -> requests.Response:
    """Fetch a URL with a polite User-Agent and raise on HTTP errors."""
    resp = requests.get(url, headers={"User-Agent": user_agent}, timeout=timeout)
    resp.raise_for_status()
    return resp


def parse(html: str, selector: str | None, attr: str | None) -> dict:
    """Parse HTML into a structured dict.

    Without a selector, returns page-level metadata + all links + visible text.
    With a selector, returns the matched elements' text (or a given attribute).
    """
    soup = BeautifulSoup(html, "lxml")

    if selector:
        matches = soup.select(selector)
        if attr:
            items = [el.get(attr) for el in matches if el.get(attr) is not None]
        else:
            items = [el.get_text(strip=True) for el in matches]
        return {"selector": selector, "attr": attr, "count": len(items), "items": items}

    title = soup.title.get_text(strip=True) if soup.title else None
    meta_desc = None
    tag = soup.find("meta", attrs={"name": "description"})
    if tag and tag.get("content"):
        meta_desc = tag["content"].strip()

    links = []
    for a in soup.find_all("a", href=True):
        links.append({"text": a.get_text(strip=True), "href": a["href"]})

    # Strip script/style noise before pulling visible text.
    for noise in soup(["script", "style", "noscript"]):
        noise.decompose()
    text = "\n".join(
        line.strip() for line in soup.get_text("\n").splitlines() if line.strip()
    )

    return {
        "title": title,
        "meta_description": meta_desc,
        "link_count": len(links),
        "links": links,
        "text": text,
    }


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Scrape a single web page to JSON.")
    p.add_argument("url", help="URL to scrape (include scheme, e.g. https://)")
    p.add_argument("--selector", help="CSS selector to extract specific elements")
    p.add_argument(
        "--attr",
        help="Attribute to extract from matched elements (e.g. href). "
        "Only used with --selector; default is element text.",
    )
    p.add_argument("--out", help="Write JSON result to this path instead of stdout")
    p.add_argument(
        "--format",
        choices=["json", "text"],
        default="json",
        help="Output format (default: json)",
    )
    args = p.parse_args(argv)

    user_agent = os.getenv("SCRAPER_USER_AGENT", DEFAULT_USER_AGENT)
    timeout = float(os.getenv("SCRAPER_TIMEOUT", "20"))
    delay = float(os.getenv("SCRAPER_REQUEST_DELAY", "0"))

    if delay > 0:
        time.sleep(delay)

    try:
        resp = fetch(args.url, timeout=timeout, user_agent=user_agent)
    except requests.exceptions.RequestException as exc:
        sys.stderr.write(f"Network/HTTP error fetching {args.url}: {exc}\n")
        return 2

    try:
        data = parse(resp.text, args.selector, args.attr)
    except Exception as exc:  # noqa: BLE001 - surface any parse failure clearly
        sys.stderr.write(f"Parse error: {exc}\n")
        return 3

    result = {
        "url": resp.url,
        "status_code": resp.status_code,
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "data": data,
    }

    if args.format == "text" and not args.selector:
        output = data.get("text", "")
    elif args.format == "text" and args.selector:
        output = "\n".join(str(i) for i in data.get("items", []))
    else:
        output = json.dumps(result, indent=2, ensure_ascii=False)

    if args.out:
        os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(output)
        sys.stderr.write(f"Wrote {len(output)} bytes to {args.out}\n")
    else:
        sys.stdout.write(output + "\n")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
