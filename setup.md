# Blast Radius Visualizer - Setup

## Quick Start

### Live local app

```bash
git clone <repo-url>
cd graph
npm install
git clone --depth 1 https://github.com/fastify/fastify.git
npm start
```

Open http://localhost:8777.

### Standalone Fastify demo

Open `blast-radius.html` directly in a browser. It is self-contained: no build step or server is required.

## What You'll See

A module dependency graph of the real Fastify codebase — 9 modules, 32 files, all edges from actual import relationships extracted via madge. Click any module to zoom into its files. Select a PR to see the blast radius animate across the graph.

The standalone demo (`blast-radius.html`) has three levels of detail:

- **Architecture** — gateway, services, databases, and external systems.
- **Modules** — Fastify internal modules affected by the selected PR.
- **Code diff leaf** — click a changed Fastify module to inspect curated real file-level diff hunks.

The `#6580 introduce log controller layer` scenario is a local demonstration based on Fastify commit `75d74e1a`; it is not a submitted PR.

## How It Works

```
PR comes in → madge extracts file imports → group files into modules →
BFS reverse-adjacency blast radius → render + animate in SVG
```

The frontend embeds the real madge data from Fastify (32 files, ~80 import edges). Module-level edges are computed from file-level imports. Utility dependencies (to Errors/Internals) are noted on the nodes but not drawn as edges to keep the graph clean — they're still included in blast radius computation.

## Two-Level Zoom

1. **Module level**: 9 modules with structural dependency edges. Every module shows "EXPLORE ▸" on hover.
2. **File level**: Click any module to see its actual files and internal import edges. External deps shown in footer.

## Project Structure

```
graph/
  server.js              # Express server on port 8777
  package.json
  lib/
    graph-builder.js     # madge → dependency graph → grouped modules
    pr-analyzer.js       # git diff parsing, file → module mapping
    blast-engine.js      # BFS blast radius computation
  public/
    index.html           # Frontend: real Fastify graph viz, animation, zoom
  blast-radius.html      # Standalone offline demo, including code-diff leaf
  reports/
    fastify-75d74e1a.md  # Analysis backing the Fastify #6580 demo
  scripts/
    greptile-report.mjs  # GitHub API → node-keyed review report
  fastify/               # Local Fastify clone (git-ignored)
```

## API Endpoints

| Method | Path | What it does |
|--------|------|-------------|
| `GET` | `/api/graph` | Returns the module dependency graph from Fastify |
| `POST` | `/api/analyze` | Analyzes a git diff between branches |
| `POST` | `/api/analyze-mock` | Computes blast radius from supplied files |

### `/api/analyze-mock` body

```json
{ "files": ["lib/hooks.js", "lib/reply.js"] }
```

## Who Works on What

| File | Role | Tasks |
|------|------|-------|
| `lib/graph-builder.js` | **Graph** | More repo profiles, auto-detect project type, TS/Python/Go support |
| `lib/pr-analyzer.js` | **PR** | GitHub PR URL fetching, LLM-powered summaries |
| `lib/blast-engine.js` | **Engine** | Weighted edges, config-change detection, multi-level blast |
| `public/index.html` | **Frontend** | More animation effects, layout tuning, live PR input |
| `server.js` | **Infra** | WebSocket live updates, GitHub webhook, caching |

## Standalone Demo Development

`blast-radius.html` is organized into labeled `SECTION:` blocks:

| Section | What's there | What to add |
|---------|-------------|-------------|
| **CONFIG** | Animation timing, colors, sizes | Themes and timing changes |
| **ARCHITECTURE DATA** | System nodes and edges | Services, databases, external APIs |
| **MODULE DATA** | Fastify internal modules | More zoomable service graphs |
| **PR DEFINITIONS** | Mock PR scenarios | New change scenarios |
| **CODE_DIFFS** | File-level unified diff hunks | More files or richer excerpts |
| **GRAPH / ANIMATION / BLAST ENGINE** | Rendering, layout, reverse BFS | Custom layouts and effects |
| **SIDEBAR / PANEL / ZOOM** | UI and level transitions | Filters and further drill-down |
| **CODE DIFF PANEL** | Tabs, line numbers, diff rendering | Full patches, comments, syntax highlighting |

### Adding a mock PR

Add an entry to the `PRS` array. Define direct architecture and module changes; indirect impact is computed automatically.

```javascript
{
  id: '#1234',
  title: 'your PR title',
  type: 'feat',
  author: 'yourname',
  arch: { gateway: { summary: 'What changed', add: 10, del: 2 } },
  mod: { routing: { files: ['route.js'], add: 8, del: 2, summary: 'Route changes' } }
}
```

To let a changed module open the code-diff leaf, add `CODE_DIFFS` entries keyed by PR ID and module ID:

```javascript
const CODE_DIFFS = {
  '#1234': {
    routing: [{
      file: 'lib/route.js', add: 8, del: 2,
      diff: ['@@ -10,3 +10,4 @@', ' function route () {', '-  return oldHandler()', '+  return newHandler()', ' }']
    }]
  }
}
```

## Adding a New Repo Profile

In `lib/graph-builder.js`, add a group definition like `FASTIFY_GROUPS`:

```javascript
const MY_REPO_GROUPS = {
  api:      { label: 'API Layer', tag: 'HTTP', match: f => /routes|controllers/.test(f) },
  models:   { label: 'Models', tag: 'DATA', match: f => /models|entities/.test(f) },
  services: { label: 'Services', tag: 'BUSINESS', match: f => /services/.test(f) },
  utils:    { label: 'Utilities', tag: 'SHARED', match: f => /utils|helpers/.test(f) },
}
```

## Data Sources

Everything in the visualization comes from real Fastify data:
- **32 files** extracted via `npx madge --json fastify.js`
- **~80 import edges** from actual `require()` calls
- **9 module groups** based on file naming conventions (routing, errors, validation, etc.)
- **3 demo PRs** reference real Fastify file names with plausible change descriptions

## Greptile Integration

Greptile review findings can be converted into a node-keyed report the visualizer can overlay on a blast radius.

1. Install the Greptile GitHub App on `machmoon/graph` and wait for indexing.
2. `greptile.json` requests severity tags and downstream-file references.
3. Run the local report script:

```bash
GITHUB_TOKEN=ghp_... node scripts/greptile-report.mjs 42
GITHUB_TOKEN=ghp_... node scripts/greptile-report.mjs 42 owner/repo
```

`impact.arch` and `impact.mod` use the same node IDs as the visualizer. `findings[]` retains inline comments, severity, and mapped downstream mentions; `unmapped[]` records paths with no component-map rule.

## Future Ideas

- Function-level graph from a code diff into symbols and call sites
- Live GitHub PR ingestion and automatic component mapping
- Configuration-only and cross-repository impact analysis
- AI-generated per-module change summaries
