// Active Greptile client.
//
// The passive path (lib/greptile.js) waits for Greptile to comment on a PR and
// scrapes whatever it happened to say. This one goes the other way: the blast
// engine computes which modules a change propagates to, and we *ask* Greptile
// about exactly those modules — no PR required.
//
//   GREPTILE_API_KEY  (env or .env) — https://app.greptile.com/settings/api
//   GITHUB_TOKEN      — Greptile uses it to read the repo on your behalf
const { mapPath, parseSeverity, aggregateImpact } = require('./greptile');

const API = 'https://api.greptile.com/v2';
const SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);

function repositoryId(remote, branch, repository) {
  return encodeURIComponent(`${remote}:${branch}:${repository}`);
}

function makeGreptileClient(apiKey, githubToken) {
  if (!globalThis.fetch) throw new Error('Node 18+ required (global fetch)');
  if (!apiKey) {
    const err = new Error('GREPTILE_API_KEY is not set — add it to .env to enable active review');
    err.status = 501;
    throw err;
  }

  async function call(path, { method = 'GET', body } = {}) {
    const res = await globalThis.fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-GitHub-Token': githubToken || '',
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`Greptile ${res.status} for ${path}: ${text.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    try { return JSON.parse(text); } catch { return { raw: text }; }
  }

  return {
    // Kick off (or check) indexing. Greptile can only answer about repos it has indexed.
    index: (repository, branch, { remote = 'github', reload = false } = {}) =>
      call('/repositories', { method: 'POST', body: { remote, repository, branch, reload, notify: false } }),
    status: (repository, branch, { remote = 'github' } = {}) =>
      call(`/repositories/${repositoryId(remote, branch, repository)}`),
    query: (messages, repositories, { sessionId, genius = true } = {}) =>
      call('/query', { method: 'POST', body: { messages, repositories, sessionId, stream: false, genius } }),
  };
}

// ── Prompt ───────────────────────────────────────────────────
// Hands Greptile the graph's own prediction and asks it to adjudicate, module by
// module. The point is that it answers about the *downstream* modules, which a
// PR-diff review never looks at because they contain no changed lines.
function buildReviewPrompt({ changedFiles, hops, nodeFiles, nodeLabels }) {
  const changed = changedFiles
    .map(f => `  ${f.file || f.path}  (+${f.add ?? f.additions ?? 0}/-${f.del ?? f.deletions ?? 0})`)
    .join('\n');

  const downstream = hops
    .map((ids, hop) => {
      if (!ids.length) return null;
      const lines = ids.map(id => {
        const files = (nodeFiles[id] || []).slice(0, 12).join(', ') || '(no files resolved)';
        return `    - ${nodeLabels[id] || id} [${id}]: ${files}`;
      });
      return `  hop ${hop}${hop === 0 ? ' (directly changed)' : ''}:\n${lines.join('\n')}`;
    })
    .filter(Boolean)
    .join('\n');

  return `A static import graph of this repository says the following files changed:

${changed}

...and that the change propagates outward to these modules, by hop distance:

${downstream}

The import graph only knows that an edge exists. It does not know whether the change
actually breaks anything on the other end. That is what I need from you.

For every module at hop 1 or greater, read the real code and decide whether this change
genuinely breaks it, or whether the dependency edge is incidental. Be specific: name the
function, the call site, the assumption that no longer holds. If a module is fine, say so
and say why — a confident "no impact" is as useful as a finding.

Also call out anything the import graph CANNOT see that this change affects: dynamic
requires, event names, hook ordering, shared symbols, serialized shapes, plugin
registration order, monkey-patched prototypes.

Reply with prose, then a final fenced json block in exactly this form:

\`\`\`json
{
  "verdicts": [
    {
      "node": "<module id from the list above>",
      "breaks": true,
      "severity": "critical|high|medium|low",
      "path": "<repo-relative file that would break>",
      "line": 123,
      "reason": "<one or two sentences, specific>"
    }
  ],
  "invisibleToGraph": [
    { "path": "<file>", "severity": "high", "reason": "<coupling the import graph misses>" }
  ]
}
\`\`\`
Use "breaks": false for modules you cleared. Omit "line" when you do not have one.`;
}

// ── Response parsing ─────────────────────────────────────────
function extractJsonBlock(message) {
  const fences = [...String(message || '').matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  for (const m of fences.reverse()) {
    try {
      const parsed = JSON.parse(m[1].trim());
      if (parsed && (parsed.verdicts || parsed.invisibleToGraph)) return parsed;
    } catch { /* try the next fence */ }
  }
  return null;
}

function normalizeSeverity(value, fallbackBody) {
  const s = String(value || '').toLowerCase();
  return SEVERITIES.has(s) ? s : parseSeverity(fallbackBody || '');
}

// Converts a Greptile answer into the same finding shape the passive scrape
// produces, so public/index.html can render both without knowing the difference.
function toFindings(parsed, message, sources) {
  const findings = [];

  for (const v of (parsed && parsed.verdicts) || []) {
    if (!v || v.breaks === false) continue;
    const body = v.reason || '';
    findings.push({
      path: v.path || null,
      line: Number.isFinite(v.line) ? v.line : null,
      severity: normalizeSeverity(v.severity, body),
      body,
      node: v.node || null,
      origin: 'active',
      ...(v.path ? mapPath(v.path) : { arch: null, mod: null }),
      mentions: [],
    });
  }

  for (const c of (parsed && parsed.invisibleToGraph) || []) {
    if (!c || !c.reason) continue;
    findings.push({
      path: c.path || null,
      line: null,
      severity: normalizeSeverity(c.severity, c.reason),
      body: `[not visible to the import graph] ${c.reason}`,
      origin: 'active-invisible',
      ...(c.path ? mapPath(c.path) : { arch: null, mod: null }),
      mentions: [],
    });
  }

  // A verdict names a module id; if Greptile gave no usable path, fall back to
  // the node it named so the finding still lands somewhere on the graph.
  for (const f of findings) {
    if (!f.mod && f.node) f.mod = f.node;
  }

  // No parseable json block — keep the prose rather than silently returning nothing.
  if (!findings.length && message) {
    findings.push({
      path: (sources && sources[0] && sources[0].filepath) || null,
      line: null, severity: parseSeverity(message), body: message,
      origin: 'active-unstructured', mentions: [],
      ...mapPath((sources && sources[0] && sources[0].filepath) || ''),
    });
  }

  return findings;
}

// ── Entry point ──────────────────────────────────────────────
// changedFiles: [{ file, add, del }]   blast: output of computeBlastRadius
// nodeFiles:    { nodeId: [paths] }    nodeLabels: { nodeId: 'Routing' }
async function reviewBlastRadius(client, { repository, branch, changedFiles, blast, nodeFiles, nodeLabels, sessionId }) {
  const prompt = buildReviewPrompt({ changedFiles, hops: blast.hops || [], nodeFiles, nodeLabels });
  const repositories = [{ remote: 'github', repository, branch }];

  const answer = await client.query(
    [{ id: 'blast-radius-review', role: 'user', content: prompt }],
    repositories,
    { sessionId },
  );

  const message = answer.message || answer.raw || '';
  const sources = answer.sources || [];
  const parsed = extractJsonBlock(message);
  const findings = toFindings(parsed, message, sources);

  const cleared = ((parsed && parsed.verdicts) || []).filter(v => v && v.breaks === false).map(v => v.node);
  const files = changedFiles.map(f => ({
    path: f.file || f.path,
    additions: f.add ?? f.additions ?? 0,
    deletions: f.del ?? f.deletions ?? 0,
    ...mapPath(f.file || f.path),
  }));

  return {
    generatedFrom: 'greptile-active',
    repo: repository,
    branch,
    prompt,
    message,
    sources,
    structured: Boolean(parsed),
    cleared,
    files,
    findings,
    impact: {
      arch: aggregateImpact('arch', files, findings),
      mod: aggregateImpact('mod', files, findings),
    },
  };
}

module.exports = { makeGreptileClient, reviewBlastRadius, buildReviewPrompt, extractJsonBlock, toFindings };
