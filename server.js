const express = require('express');
const path = require('path');
const { buildGraph, groupFiles, FASTIFY_GROUPS } = require('./lib/graph-builder');
const { parseDiffStat, mapFilesToGroups } = require('./lib/pr-analyzer');
const { computeBlastRadius } = require('./lib/blast-engine');
const { makeClient, buildReport, readDotEnv } = require('./lib/greptile');

const app = express();
const PORT = 8777;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Live PR reports (GitHub → Greptile → here) ──────────
// Polls GitHub for PRs on GITHUB_REPO, pulls Greptile's review comments back
// out, and keeps a node-keyed report per PR in memory. Nothing is hardcoded:
// open a PR, Greptile reviews it, the next poll picks it up.
//   GITHUB_TOKEN  (env or .env) — strongly recommended; unauthenticated = 60 req/h
//   GITHUB_REPO   default machmoon/graph
//   POLL_MS       default 60s with a token, 5min without
const dotenv = readDotEnv();
const GH_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || dotenv.GITHUB_TOKEN || '';
const GH_REPO = process.env.GITHUB_REPO || dotenv.GITHUB_REPO || 'machmoon/graph';
const POLL_MS = Number(process.env.POLL_MS || dotenv.POLL_MS) || (GH_TOKEN ? 60_000 : 300_000);
const gh = makeClient(GH_TOKEN);
const reports = new Map();            // pr number -> report
const poll = { last: null, error: null, inFlight: false };

async function refreshReports() {
  if (poll.inFlight) return;
  poll.inFlight = true;
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

let cachedGraph = null;
let cachedGrouped = null;

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

    if (!cachedGrouped) {
      const repoPath = repo || path.join(__dirname, 'fastify');
      const entry = req.body.entry || 'fastify.js';
      cachedGraph = await buildGraph(repoPath, entry);
      cachedGrouped = groupFiles(cachedGraph.raw, FASTIFY_GROUPS);
    }

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
  console.log(`  GET  /                   — visualizer`);
});
