# Blast Radius Visualizer - Setup

## Quick Start

### Live local app

```bash
git clone <repo-url>
cd graph
npm install
git submodule update --init --recursive
npm start
```

Open http://localhost:8777.

### Standalone Fastify demo

Open `public/index.html` directly in a browser. It is self-contained: no build step or server is required.

## What You'll See

A module dependency graph of the real Fastify codebase — 9 modules, 32 files, all edges from actual import relationships extracted via madge. Click any module to zoom into its files. Select a PR to see the blast radius animate across the graph.

The standalone demo (`public/index.html`) has three levels of detail:

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
  lib/greptile.js        # GitHub API + Greptile comments → node-keyed PR report
  scripts/
    component-map.json   # file path prefix → graph node id
  docs/
    fastify-75d74e1a.md  # Analysis backing the Fastify #6580 demo
  fastify/               # Fastify submodule, pinned to the demo commit
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

`public/index.html` is organized into labeled `SECTION:` blocks:

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

Two directions, and they answer different questions.

**Passive (polled).** Reacts to whatever Greptile decided to say about a PR diff:
```
PR pushed → Greptile reviews & comments on GitHub → server polls GitHub → public/index.html updates
```

**Active (on demand).** The graph does the asking, so the review covers modules the diff never touched:
```
pick a module → blast engine computes the downstream set → POST /api/review → Greptile answers about
those specific modules → findings render on the graph
```
A PR review only reads files with changed lines. The interesting question — *does the module three hops
downstream actually break?* — is one no diff review ever asks, because that module has no diff. Active
review asks it, and also asks about coupling the import graph structurally cannot see (dynamic requires,
event names, hook ordering, shared symbols).

Nothing is hardcoded. `server.js` polls the GitHub API for PRs on `GITHUB_REPO`, pulls Greptile's
inline comments + summary back out, maps changed files to graph nodes, and serves the result at
`GET /api/reports`. The page re-fetches that every 30s and rebuilds the PR list, badges, and diff
panel (real patches from the GitHub API) from it. Open the page at
**http://localhost:8777/** — over `file://` it falls back to offline demo data.

### One-time setup
1. Install the Greptile GitHub App on the repo at https://app.greptile.com and enable the repo.
   `greptile.json` tells Greptile to tag findings `[critical|high|medium|low]` and to list
   downstream files in a "Downstream impact" section — the parser relies on both.
2. Create `.env` (git-ignored) so the server isn't stuck on GitHub's 60 req/h anonymous limit:
   ```
   GITHUB_TOKEN=github_pat_...       # fine-grained: Pull requests: read, Contents: read
   GITHUB_REPO=machmoon/graph        # repo the poller watches for PRs
   POLL_MS=60000                     # optional; default 60s with token, 5min without

   GREPTILE_API_KEY=...              # required for active review — app.greptile.com/settings/api
   GREPTILE_REPO=machmoon/fastify    # repo Greptile reads source from (the fork, not this one)
   GREPTILE_BRANCH=main
   ```
   `GREPTILE_REPO` is the Fastify fork because that is what the graph is built from. Leave it unset
   and active review will ask questions about the wrong codebase.
3. Index the fork once — Greptile can only answer about repos it has indexed:
   ```
   curl -XPOST localhost:8777/api/review/index
   curl localhost:8777/api/review/index      # poll until status is COMPLETED
   ```
4. `npm start`, open a module in the visualizer, hit **⚡ Review Blast Radius**.

### Files
```
greptile.json                          # Greptile review config
lib/greptile.js                        # PASSIVE: GitHub API → node-keyed report
lib/greptile-query.js                  # ACTIVE: blast radius → Greptile query → same report shape
scripts/component-map.json             # path prefix -> ARCH_NODES / MOD_NODES id
docs/fastify-75d74e1a.md               # write-up of the Fastify #6580 stress case
```

### Endpoints
| Method | Path | What it does |
|--------|------|-------------|
| `GET` | `/api/reports` | All PR reports the server knows about (+ poll status) |
| `GET` | `/api/reports/:pr?refresh=1` | One report; `refresh` forces a rebuild from GitHub |
| `POST` | `/api/review` | **Active.** Ask Greptile about a blast radius. Body picks the change: `{node}` (a module's files), `{pr}`, `{files}`, or `{base,head}` (local git diff in `fastify/`) |
| `POST` | `/api/review/index` | Start/reload Greptile indexing of `GREPTILE_REPO` |
| `GET` | `/api/review/index` | Indexing status |

### Report shape
`impact.arch` / `impact.mod` are keyed by the visualizer's node IDs:
```json
"impact": { "arch": { "order": { "files": ["demo-repo/order-service/order.ts"], "findings": 2, "maxSeverity": "high", "add": 18, "del": 6, "downstream": false } } }
```
`findings[]` = each Greptile inline comment with `path`, `line`, `severity`, `body`, plus `mentions[]`
(other files it names, already mapped). `files[].patch` feeds the diff panel. `unmapped[]` lists
changed paths with no rule in `component-map.json` — a PR that only touches the tool's own code
(`lib/`, `server.js`) shows its Greptile review but lights up no nodes.
