# Blast Radius Visualizer - Setup

## Quick Start

```bash
git clone <repo-url>
cd graph
npm install
git clone --depth 1 https://github.com/fastify/fastify.git
npm start
```

Open http://localhost:8777

## What You'll See

A module dependency graph of the real Fastify codebase — 9 modules, 32 files, all edges from actual import relationships extracted via madge. Click any module to zoom into its files. Select a PR to see the blast radius animate across the graph.

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
  fastify/               # Cloned Fastify repo (git-ignored, clone it yourself)
```

## API Endpoints

| Method | Path | What it does |
|--------|------|-------------|
| `GET` | `/api/graph` | Returns module dependency graph (runs madge on Fastify) |
| `POST` | `/api/analyze` | Analyzes a git diff between branches, returns blast radius |
| `POST` | `/api/analyze-mock` | Pass file names directly, get blast radius back |

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

## Adding a New Repo Profile

In `lib/graph-builder.js`, add a group definition like `FASTIFY_GROUPS`:

```javascript
const MY_REPO_GROUPS = {
  api:      { label: 'API Layer',   tag: 'HTTP',     match: f => /routes|controllers/.test(f) },
  models:   { label: 'Models',      tag: 'DATA',     match: f => /models|entities/.test(f) },
  services: { label: 'Services',    tag: 'BUSINESS', match: f => /services/.test(f) },
  utils:    { label: 'Utilities',   tag: 'SHARED',   match: f => /utils|helpers/.test(f) },
};
```

## Data Sources

Everything in the visualization comes from real Fastify data:
- **32 files** extracted via `npx madge --json fastify.js`
- **~80 import edges** from actual `require()` calls
- **9 module groups** based on file naming conventions (routing, errors, validation, etc.)
- **3 demo PRs** reference real Fastify file names with plausible change descriptions
