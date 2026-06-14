# Build A Web Scraper

A web-scraping project built on the **WAT framework** (Workflows, Agents, Tools).
Probabilistic AI handles reasoning; deterministic Python handles execution.

## Layout
```
.tmp/           # Temporary / regenerable files (scraped data, exports). Disposable.
tools/          # Python scripts — deterministic execution
workflows/      # Markdown SOPs — what to do and how
.env            # Secrets & config (gitignored; copy from .env.example)
CLAUDE.md       # Agent operating instructions
```

## Setup
```bash
python -m venv .venv            # optional but recommended
.venv\Scripts\activate          # Windows (PowerShell: .venv\Scripts\Activate.ps1)
pip install -r tools/requirements.txt
cp .env.example .env            # then edit values as needed
```

## Usage
```bash
# Whole-page metadata, links, and visible text:
python tools/scrape_single_site.py https://example.com --out .tmp/result.json

# Targeted extraction via CSS selector:
python tools/scrape_single_site.py https://news.ycombinator.com \
    --selector ".titleline > a" --out .tmp/titles.json

# Extract an attribute (e.g. all hrefs) as plain text:
python tools/scrape_single_site.py https://example.com --selector "a" --attr href --format text
```

See [workflows/scrape_website.md](workflows/scrape_website.md) for the full SOP,
including edge cases (bot blocks, rate limits, JS-rendered pages).

## How it fits together
1. A **workflow** (`workflows/*.md`) describes the objective and steps.
2. The **agent** reads the workflow and orchestrates the right tools in order.
3. **Tools** (`tools/*.py`) do the actual fetching and parsing, reliably.
# web-scraper
