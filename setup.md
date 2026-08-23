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

A system architecture diagram (gateway, services, databases). Click a PR in the sidebar to see the blast radius animate — glowing balls travel along edges showing which components are affected. Click the API Gateway node to zoom into the Fastify module graph (loaded from real dependency data via madge).

## Pipeline

```
PR comes in → madge extracts dependency graph → map changed files to modules → BFS blast radius → render + animate
```

Right now the architecture level is hardcoded (system design diagram) and the module level is live from the API (real Fastify imports via madge). The demo PRs are mock data.

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
    index.html           # Frontend: graph viz, animation, controls
  blast-radius.html      # Standalone offline demo (no server needed)
  fastify/               # Cloned Fastify repo (git-ignored, clone it yourself)
```

## API Endpoints

| Method | Path | What it does |
|--------|------|-------------|
| `GET` | `/api/graph` | Returns module dependency graph (runs madge on Fastify) |
| `POST` | `/api/analyze` | Analyzes a git diff between branches, returns blast radius |
| `POST` | `/api/analyze-mock` | Pass file names directly, get blast radius back |

### `/api/analyze` body

```json
{ "repo": "path/to/repo", "base": "main", "head": "feature-branch" }
```

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
| `public/index.html` | **Frontend** | More zoom levels, animation effects, layout tuning |
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

The `match` function decides which files belong to which module. Madge handles dependency extraction.

## Adding GitHub PR Support

In `lib/pr-analyzer.js`:
1. Accept a PR URL like `https://github.com/org/repo/pull/123`
2. Use GitHub API: `GET /repos/{owner}/{repo}/pulls/{number}/files`
3. Extract the file list → feed into `mapFilesToGroups()` (already works)

## Future Ideas

- **GitHub webhook**: auto-analyze on PR open, post blast radius as PR comment
- **Config-type PRs**: scaling pods, env var changes — infra impact without code changes
- **AI summaries**: LLM generates "what changed and why" per module
- **Level 3 zoom**: file-level or function-level graphs inside a module
- **Multi-repo**: cross-repo dependency visualization

## Greptile Integration

Greptile reviews each PR with whole-repo context; we pull its findings back out of GitHub and turn them into a node-keyed report the visualizer can overlay on the blast radius.

### One-time setup (in the browser — cannot be scripted)
1. Go to https://app.greptile.com, sign in with GitHub, and install the Greptile GitHub App on `machmoon/graph`.
2. Let it finish indexing the repo (a few minutes).
3. `greptile.json` in the repo root configures the review: it asks Greptile to tag findings with `[critical|high|medium|low]` and to list downstream files/services in backticks — the report script parses those.

### Files
```
greptile.json                          # Greptile review config (severity tags, downstream-impact section)
scripts/component-map.json             # path prefix -> ARCH_NODES / MOD_NODES id
scripts/greptile-report.mjs            # GitHub API -> reports/<pr>.json
.github/workflows/greptile-report.yml  # runs the script whenever a review/comment lands on a PR
reports/<pr>.json                      # generated output, committed to main
```

### Run locally
```bash
GITHUB_TOKEN=ghp_... node scripts/greptile-report.mjs 42            # defaults to machmoon/graph
GITHUB_TOKEN=ghp_... node scripts/greptile-report.mjs 42 owner/repo
```

### Report shape
`impact.arch` / `impact.mod` are keyed by the same node IDs the visualizer uses, so they can be merged straight into a `PRS` entry:
```json
"impact": { "arch": { "order": { "files": ["demo-repo/order-service/order.ts"], "findings": 2, "maxSeverity": "high", "add": 18, "del": 6, "downstream": false } } }
```
`findings[]` carries each Greptile inline comment with `path`, `line`, `severity`, `body`, plus `mentions[]` — other files Greptile says are affected, already mapped to node IDs. `summary.downstream[]` is the parsed "Downstream impact" section. `unmapped[]` lists changed paths with no rule in `component-map.json`.
