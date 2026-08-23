const express = require('express');
const path = require('path');
const { execFileSync } = require('child_process');
const { buildGraph, groupFiles, FASTIFY_GROUPS } = require('./lib/graph-builder');
const { parseDiffStat, mapFilesToGroups } = require('./lib/pr-analyzer');
const { computeBlastRadius } = require('./lib/blast-engine');
const { makeClient, buildReport, readDotEnv } = require('./lib/greptile');
const { makeGreptileClient, reviewBlastRadius } = require('./lib/greptile-query');

const app = express();
const PORT = 8777;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Live PR reports (GitHub → Greptile → here) ──────────
// Polls GitHub for PRs on GITHUB_REPO, pulls Greptile's review comments back
// out, and keeps a node-keyed report per PR in memory. Nothing is hardcoded:
// open a PR, Greptile reviews it, the next poll picks it up.
//   GITHUB_TOKEN  (env or .env) — strongly recommended; unauthenticated = 60 req/h
//   GITHUB_REPO   default machmoon/fastify (the Fastify fork; the submodule tracks its main)
//   SYNC_SUBMODULE default 1 — each poll also fast-forwards ./fastify to the fork's main
//   POLL_MS       default 60s with a token, 5min without
const dotenv = readDotEnv();
const GH_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || dotenv.GITHUB_TOKEN || '';
const GH_REPO = process.env.GITHUB_REPO || dotenv.GITHUB_REPO || 'machmoon/fastify';
const SYNC_SUBMODULE = (process.env.SYNC_SUBMODULE ?? dotenv.SYNC_SUBMODULE ?? '1') !== '0';
const FASTIFY_DIR = path.join(__dirname, 'fastify');
const POLL_MS = Number(process.env.POLL_MS || dotenv.POLL_MS) || (GH_TOKEN ? 60_000 : 300_000);
const gh = makeClient(GH_TOKEN);

// ── Active review config ────────────────────────────────
// GREPTILE_REPO is the repo Greptile actually reads source from. That is the
// Fastify fork, not this umbrella repo — the graph is built from fastify/.
const GREPTILE_KEY = process.env.GREPTILE_API_KEY || dotenv.GREPTILE_API_KEY || '';
const GREPTILE_REPO = process.env.GREPTILE_REPO || dotenv.GREPTILE_REPO || 'machmoon/fastify';
const GREPTILE_BRANCH = process.env.GREPTILE_BRANCH || dotenv.GREPTILE_BRANCH || 'main';
let cachedGraph = null;
let cachedGrouped = null;
const reports = new Map();            // pr number -> report
const poll = { last: null, error: null, inFlight: false, submodule: null };

// Keep ./fastify (the submodule) on the fork's main so /api/graph reflects what PRs merge into.
function git(...args) { return execFileSync('git', args, { cwd: FASTIFY_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function syncSubmodule() {
  if (!SYNC_SUBMODULE) return;
  try {
    const before = git('rev-parse', 'HEAD');
    git('fetch', '-q', 'origin', 'main');
    const after = git('rev-parse', 'FETCH_HEAD');
    if (before === after) return;
    if (git('status', '--porcelain')) { console.warn('[submodule] ./fastify has local changes; not moving it'); return; }
    git('checkout', '-q', '--detach', after);
    cachedGraph = null; cachedGrouped = null;
    poll.submodule = after;
    console.log(`[submodule] fastify ${before.slice(0, 8)} → ${after.slice(0, 8)}; graph cache cleared`);
  } catch (err) { console.warn(`[submodule] sync failed: ${err.message.split('\n')[0]}`); }
}

async function refreshReports() {
  if (poll.inFlight) return;
  poll.inFlight = true;
  syncSubmodule();
  try {
    const prs = await gh(`/repos/${GH_REPO}/pulls?state=all&sort=updated&direction=desc`);
    for (const pr of prs.slice(0, 20)) {
      const cached = reports.get(pr.number);
      // Rebuild when the PR changed, or while we're still waiting for Greptile to show up.
      if (cached && cached.pr.updatedAt === pr.updated_at && cached.greptileReviewed) continue;
      try {
        reports.set(pr.number, await buildReport(gh, GH_REPO, pr.number, pr));
      } catch (err) { console.warn(`[greptile] PR #${pr.number}: ${err.message}`); if (err.status === 403) break; }
    }
    poll.error = null;
  } catch (err) {
    poll.error = err.message; console.warn(`[greptile] poll failed: ${err.message}`);
  } finally {
    poll.last = new Date().toISOString(); poll.inFlight = false;
  }
}
refreshReports();
setInterval(refreshReports, POLL_MS).unref();

// GET /api/reports — every PR report the server knows about, newest first
app.get('/api/reports', (_req, res) => {
  res.json({
    repo: GH_REPO, authenticated: Boolean(GH_TOKEN), pollMs: POLL_MS, lastPoll: poll.last, error: poll.error,
    reports: [...reports.values()].sort((a, b) => (a.pr.updatedAt < b.pr.updatedAt ? 1 : -1)),
  });
});
// GET /api/reports/:pr — one report; ?refresh=1 forces a rebuild
app.get('/api/reports/:pr', async (req, res) => {
  const n = Number(req.params.pr);
  try {
    if (req.query.refresh || !reports.has(n)) reports.set(n, await buildReport(gh, GH_REPO, n));
    res.json(reports.get(n));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});


async function ensureGraph(repoPath, entry = 'fastify.js') {
  if (cachedGrouped) return cachedGrouped;
  cachedGraph = await buildGraph(repoPath || path.join(__dirname, 'fastify'), entry);
  cachedGrouped = groupFiles(cachedGraph.raw, FASTIFY_GROUPS);
  return cachedGrouped;
}

// ── GET /api/graph ──────────────────────────────────────
// Returns the module-level dependency graph for the target repo.
// Teammates: extend this to support multiple repos or architecture-level graphs.
app.get('/api/graph', async (req, res) => {
  try {
    const repoPath = req.query.repo || path.join(__dirname, 'fastify');
    const entry = req.query.entry || 'fastify.js';

    cachedGraph = await buildGraph(repoPath, entry);
    cachedGrouped = groupFiles(cachedGraph.raw, FASTIFY_GROUPS);

    const nodes = Object.entries(FASTIFY_GROUPS).map(([id, def]) => ({
      id,
      label: def.label,
      tag: def.tag,
      fileCount: (cachedGrouped.groups[id] || []).length,
    }));

    res.json({
      nodes,
      edges: cachedGrouped.edges,
      totalFiles: cachedGraph.files.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/analyze ───────────────────────────────────
// Accepts a PR (git branch or list of changed files) and returns blast radius.
// Body: { repo?, base?, head?, files? }
//   - repo + base + head: analyze a git branch diff
//   - files: directly pass changed file list [{file, add, del}]
// Teammates: add GitHub PR URL support, LLM summary generation here.
app.post('/api/analyze', async (req, res) => {
  try {
    const { repo, base = 'main', head = 'HEAD', files } = req.body;

    await ensureGraph(repo, req.body.entry);

    let changedFiles;
    if (files) {
      changedFiles = files;
    } else {
      const repoPath = repo || path.join(__dirname, 'fastify');
      changedFiles = parseDiffStat(repoPath, base, head);
    }

    const affected = mapFilesToGroups(changedFiles, cachedGrouped.fileToGroup);
    const directIds = Object.keys(affected);
    const blast = computeBlastRadius(directIds, cachedGrouped.edges);

    res.json({
      changedFiles,
      affected,
      blast,
      edges: cachedGrouped.edges,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/review ────────────────────────────────────
// The active counterpart to /api/reports. Instead of waiting for Greptile to
// comment on a PR, this computes the blast radius first and asks Greptile about
// the modules downstream of the change — the ones a diff review never opens,
// because they contain no changed lines.
//
// Body (pick one source of changed files):
//   { node: 'routing' }              — treat a module's files as the change (review from the tree)
//   { pr: 7 }                        — changed files from a PR the poller has seen
//   { files: ['lib/hooks.js'] }      — explicit list
//   { base, head }                   — local git diff inside fastify/
// Optional: { repository, branch, entry, repo }
app.post('/api/review', async (req, res) => {
  try {
    if (!GREPTILE_KEY) {
      return res.status(501).json({
        error: 'GREPTILE_API_KEY is not set. Add it to .env (https://app.greptile.com/settings/api) to enable active review.',
      });
    }

    const { node, pr, files, base = 'main', head = 'HEAD', repo, entry } = req.body || {};
    const grouped = await ensureGraph(repo, entry);
    const repoPath = repo || path.join(__dirname, 'fastify');

    // ── Resolve what changed ──
    let changedFiles;
    let origin;
    if (node) {
      const nodeFiles = grouped.groups[node];
      if (!nodeFiles || !nodeFiles.length) return res.status(404).json({ error: `unknown or empty module: ${node}` });
      changedFiles = nodeFiles.map(f => ({ file: f, add: 0, del: 0 }));
      origin = `module:${node}`;
    } else if (pr) {
      const report = reports.get(Number(pr)) || await buildReport(gh, GH_REPO, Number(pr));
      // PR paths may be prefixed with the submodule dir; the graph keys are fastify-relative.
      changedFiles = report.files.map(f => ({
        file: f.path.replace(/^fastify\//, ''), add: f.additions, del: f.deletions,
      }));
      origin = `pr:${pr}`;
    } else if (files) {
      changedFiles = files.map(f => (typeof f === 'string' ? { file: f, add: 0, del: 0 } : f));
      origin = 'files';
    } else {
      changedFiles = parseDiffStat(repoPath, base, head);
      origin = `diff:${base}...${head}`;
    }

    // ── Let the graph decide what to ask about ──
    const affected = mapFilesToGroups(changedFiles, grouped.fileToGroup);
    const directIds = Object.keys(affected);
    if (!directIds.length) {
      return res.status(422).json({
        error: 'None of the changed files map onto a graph module, so there is no blast radius to review.',
        changedFiles, origin,
      });
    }
    const blast = computeBlastRadius(directIds, grouped.edges);

    const nodeFiles = {};
    for (const id of Object.keys(blast.dist)) nodeFiles[id] = grouped.groups[id] || [];
    const nodeLabels = Object.fromEntries(Object.entries(FASTIFY_GROUPS).map(([id, d]) => [id, d.label]));

    const client = makeGreptileClient(GREPTILE_KEY, GH_TOKEN);
    const review = await reviewBlastRadius(client, {
      repository: req.body.repository || GREPTILE_REPO,
      branch: req.body.branch || GREPTILE_BRANCH,
      changedFiles, blast, nodeFiles, nodeLabels,
    });

    res.json({ origin, changedFiles, affected, blast, edges: grouped.edges, review });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── POST /api/review/index ──────────────────────────────
// Greptile can only answer about repos it has indexed. Kick that off (or check
// on it) without leaving the app. Body: { repository?, branch?, reload? }
app.post('/api/review/index', async (req, res) => {
  try {
    const client = makeGreptileClient(GREPTILE_KEY, GH_TOKEN);
    const repository = (req.body && req.body.repository) || GREPTILE_REPO;
    const branch = (req.body && req.body.branch) || GREPTILE_BRANCH;
    const started = await client.index(repository, branch, { reload: Boolean(req.body && req.body.reload) });
    res.json({ repository, branch, started });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

app.get('/api/review/index', async (req, res) => {
  try {
    const client = makeGreptileClient(GREPTILE_KEY, GH_TOKEN);
    const repository = req.query.repository || GREPTILE_REPO;
    const branch = req.query.branch || GREPTILE_BRANCH;
    res.json(await client.status(repository, branch));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// ── POST /api/analyze-mock ──────────────────────────────
// Quick endpoint for demo: pass file names directly without a real git diff.
// Body: { files: ["lib/hooks.js", "lib/reply.js", ...] }
app.post('/api/analyze-mock', (req, res) => {
  if (!cachedGrouped) {
    return res.status(400).json({ error: 'Call GET /api/graph first to load the graph' });
  }

  const files = (req.body.files || []).map(f => ({ file: f, add: 10, del: 2 }));
  const affected = mapFilesToGroups(files, cachedGrouped.fileToGroup);
  const directIds = Object.keys(affected);
  const blast = computeBlastRadius(directIds, cachedGrouped.edges);

  res.json({ affected, blast, edges: cachedGrouped.edges });
});

app.listen(PORT, () => {
  console.log(`Blast Radius server running at http://localhost:${PORT}`);
  console.log(`  GET  /api/graph          — load dependency graph`);
  console.log(`  POST /api/analyze        — analyze a PR (git diff or file list)`);
  console.log(`  POST /api/analyze-mock   — quick demo with file names`);
  console.log(`  GET  /api/reports        — live PR reports from GitHub + Greptile (${GH_REPO}, ${GH_TOKEN ? 'authenticated' : 'NO TOKEN — set GITHUB_TOKEN in .env'})`);
  console.log(`  POST /api/review         — ACTIVE: ask Greptile about the blast radius (${GREPTILE_KEY ? `${GREPTILE_REPO}@${GREPTILE_BRANCH}` : 'NO KEY — set GREPTILE_API_KEY in .env'})`);
  console.log(`  GET  /                   — visualizer`);
});
