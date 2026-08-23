const express = require('express');
const path = require('path');
const { buildGraph, groupFiles, FASTIFY_GROUPS } = require('./lib/graph-builder');
const { parseDiffStat, mapFilesToGroups } = require('./lib/pr-analyzer');
const { computeBlastRadius, computeWeightedBlast } = require('./lib/blast-engine');

const app = express();
const PORT = 8777;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
    const weighted = computeWeightedBlast(directIds, cachedGrouped.edges);

    res.json({
      changedFiles,
      affected,
      blast,
      weighted,
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
  const weighted = computeWeightedBlast(directIds, cachedGrouped.edges);

  res.json({ affected, blast, weighted, edges: cachedGrouped.edges });
});

app.listen(PORT, () => {
  console.log(`Blast Radius server running at http://localhost:${PORT}`);
  console.log(`  GET  /api/graph          — load dependency graph`);
  console.log(`  POST /api/analyze        — analyze a PR (git diff or file list)`);
  console.log(`  POST /api/analyze-mock   — quick demo with file names`);
});
