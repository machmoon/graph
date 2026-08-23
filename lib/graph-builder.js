const madge = require('madge');
const path = require('path');

async function buildGraph(repoPath, entryFile) {
  const res = await madge(path.join(repoPath, entryFile), {
    baseDir: repoPath,
  });
  const raw = res.obj();

  const files = Object.keys(raw);
  const edges = [];
  for (const [file, deps] of Object.entries(raw)) {
    for (const dep of deps) {
      edges.push([file, dep]);
    }
  }

  return { files, edges, raw };
}

function groupFiles(raw, groupDefs) {
  const fileToGroup = {};
  for (const [groupId, { match }] of Object.entries(groupDefs)) {
    for (const file of Object.keys(raw)) {
      if (match(file)) fileToGroup[file] = groupId;
    }
  }

  const groupEdges = new Set();
  for (const [file, deps] of Object.entries(raw)) {
    const fg = fileToGroup[file];
    if (!fg) continue;
    for (const dep of deps) {
      const dg = fileToGroup[dep];
      if (dg && dg !== fg) groupEdges.add(`${fg}|${dg}`);
    }
  }

  const groups = {};
  for (const [file, groupId] of Object.entries(fileToGroup)) {
    if (!groups[groupId]) groups[groupId] = [];
    groups[groupId].push(file);
  }

  return {
    groups,
    edges: [...groupEdges].map(e => e.split('|')),
    fileToGroup,
  };
}

// Default grouping for Fastify — teammates: add more repo profiles here
const FASTIFY_GROUPS = {
  core:       { label: 'Core',             tag: 'ENTRY',         match: f => f === 'fastify.js' },
  plugins:    { label: 'Plugins',          tag: 'EXTENSION',     match: f => /plugin/.test(f) },
  server:     { label: 'Server & Hooks',   tag: 'LIFECYCLE',     match: f => /server|hooks/.test(f) },
  routing:    { label: 'Routing',          tag: 'HTTP',          match: f => /route|four-oh-four|head-route|handle-request|context/.test(f) },
  reqres:     { label: 'Request / Reply',  tag: 'I/O',           match: f => /request|reply|content-type/.test(f) },
  validation: { label: 'Validation',       tag: 'SCHEMA',        match: f => /valid|schema/.test(f) },
  errors:     { label: 'Error Handling',   tag: 'ERRORS',        match: f => /error/.test(f) },
  logging:    { label: 'Logging',          tag: 'OBSERVABILITY', match: f => /log/.test(f) },
  internals:  { label: 'Internals',        tag: 'SHARED',        match: f => /symbol|wrap|warning|noop|decorate|config-validator|req-id/.test(f) },
};

module.exports = { buildGraph, groupFiles, FASTIFY_GROUPS };
