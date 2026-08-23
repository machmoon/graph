# Blast Radius Visualizer - Setup

## Quick Start

1. Clone this repo
2. Open `blast-radius.html` in a browser — that's the demo, no build step needed

## Project Structure

```
graph/
  blast-radius.html    # Main demo (self-contained, no dependencies)
  graph-data.json      # Real dependency graph extracted from Fastify
  setup.md             # You are here
  fastify/             # Cloned Fastify repo (used to extract graph data)
  demo-repo/           # Dummy microservice repo (scaffolded, not used yet)
```

## How It Works

`blast-radius.html` is a single self-contained HTML file with inline CSS/JS. No npm, no bundler, no server required. Just open it in a browser.

It renders three levels of detail:
- **Level 1 (Architecture)**: System design diagram — gateway, services, databases, etc.
- **Level 2 (Modules)**: Fastify internal modules — click the API Gateway node to zoom in
- **Final leaf (Code diff)**: Click a changed Fastify module to inspect real file-level diff hunks

When you pick a PR from the sidebar, it runs BFS through a reverse dependency graph to compute direct + indirect impact, then animates the blast radius with glowing balls traveling along edges.

## Where to Work

The code is organized into labeled sections. Search for `SECTION:` to find them:

| Section | What's there | What to add |
|---------|-------------|-------------|
| **CONFIG** | Animation timing, colors, sizes | Tune speed, add color themes |
| **ARCHITECTURE DATA** | System nodes + edges | New services, databases, external APIs |
| **MODULE DATA** | Fastify internal modules | More zoomable services with their own module graphs |
| **PR DEFINITIONS** | Mock PRs with change data | New PR scenarios, different change types |
| **CODE_DIFFS** | File-level unified diff hunks for a PR/module | More files or richer code excerpts |
| **GRAPH ENGINE** | SVG rendering, layout, reverse adjacency | Custom layouts, node shapes, edge routing |
| **ANIMATION ENGINE** | Ball animation, highlighting, step queue | New animation effects, trails, particles |
| **BLAST ANALYSIS** | Impact computation, animation orchestration | New analysis modes (config changes, scaling) |
| **SIDEBAR & PANEL** | PR list, analysis panel, tooltips | Filters, search, summary cards |
| **ZOOM / DRILL-DOWN** | Level transitions | More zoom levels (Level 3: files/functions) |
| **CODE DIFF PANEL** | File tabs, line numbers, diff rendering | Full patches, comments, syntax highlighting |

## Adding a New PR

Add an entry to the `PRS` array:

```javascript
{
  id: '#1234',
  title: 'your PR title',
  type: 'feat',          // 'feat' | 'fix' | 'refactor' — controls color
  author: 'yourname',
  arch: {                 // architecture-level changes (node IDs from ARCH_NODES)
    gateway: { summary: 'What changed', add: 10, del: 2 },
    redis:   { summary: 'Cache invalidation added', add: 5, del: 0 },
  },
  mod: {                  // module-level changes (node IDs from MOD_NODES, optional)
    routing: { files: ['route.js'], add: 8, del: 2, summary: 'Route changes' },
  }
}
```

Indirect impact is computed automatically — you only define direct changes.

To make a changed module open the final code leaf, add matching entries to
`CODE_DIFFS`, keyed by PR ID and module ID. Each file supplies its totals and a
small unified-diff array:

```javascript
const CODE_DIFFS = {
  '#1234': {
    routing: [{
      file: 'lib/route.js',
      add: 8,
      del: 2,
      diff: [
        '@@ -10,3 +10,4 @@',
        ' function route () {',
        '-  return oldHandler()',
        '+  return newHandler()',
        ' }',
      ]
    }]
  }
}
```

## Adding a New Zoomable Service

1. Add `zoomable: true` and `zoomLabel: 'N modules'` to the node in `ARCH_NODES`
2. Create a new `YOUR_NODES` and `YOUR_EDGES` array (same format as `MOD_NODES`/`MOD_EDGES`)
3. Add a new SVG group and `renderGraph()` call
4. Wire up the zoom transition in the `ZOOM / DRILL-DOWN` section

## Extracting Real Dependency Graphs

We used [madge](https://github.com/pahen/madge) to extract the Fastify import graph:

```bash
cd fastify
npm install madge --no-save
npx madge --json fastify.js > ../graph-data.json
```

This works for any JS/TS repo. The output is an adjacency list: `{ "file.js": ["dep1.js", "dep2.js"] }`.

## Future Ideas (not implemented yet)

- **Config-type PRs**: e.g. scaling pods 2 to 4, show infra changes without code changes
- **Function-level graph**: Navigate from the code diff into symbols and call sites
- **Live GitHub integration**: Fetch real PR diffs and auto-map to components
- **AI summary**: Use an LLM to generate change descriptions from diffs
- **Multi-repo support**: Visualize cross-repo dependencies
