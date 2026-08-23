// Builds a node-keyed Greptile report for a PR straight from the GitHub API.
// Used by server.js, which polls GitHub and serves the result at /api/reports.
const fs = require('fs');
const path = require('path');

const GREPTILE_LOGINS = new Set(['greptile-apps[bot]', 'greptile-apps', 'greptile[bot]', 'greptileai']);
const SEV_ORDER = ['low', 'medium', 'high', 'critical'];
const MAP = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'component-map.json'), 'utf8')).rules;

function readDotEnv() {
  try {
    const out = {};
    for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    return out;
  } catch { return {}; }
}

function makeClient(token) {
  const fetchFn = globalThis.fetch;
  if (!fetchFn) throw new Error('Node 18+ required (global fetch)');
  return async function gh(p) {
    const out = [];
    let url = `https://api.github.com${p}${p.includes('?') ? '&' : '?'}per_page=100`;
    while (url) {
      const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'blast-radius' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetchFn(url, { headers });
      if (!res.ok) {
        const err = new Error(`GitHub ${res.status} for ${p}: ${(await res.text()).slice(0, 200)}`);
        err.status = res.status; err.rateRemaining = res.headers.get('x-ratelimit-remaining'); throw err;
      }
      const data = await res.json();
      if (!Array.isArray(data)) return data;
      out.push(...data);
      const next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') || '');
      url = next ? next[1] : null;
    }
    return out;
  };
}

function mapPath(p) {
  if (!p) return { arch: null, mod: null };
  const rule = MAP.find(r => p.startsWith(r.prefix));
  return rule ? { arch: rule.arch || null, mod: rule.mod || null } : { arch: null, mod: null };
}

function parseSeverity(body) {
  const tag = /\[(critical|high|medium|low)\]/i.exec(body);
  if (tag) return tag[1].toLowerCase();
  const b = body.toLowerCase();
  if (/\b(critical|security|vulnerab|data loss|crash)\b/.test(b)) return 'critical';
  if (/\b(bug|breaks?|incorrect|race|null|undefined|exception|will fail)\b/.test(b)) return 'high';
  if (/\b(should|consider|might|may|potential)\b/.test(b)) return 'medium';
  return 'low';
}

function mentionedPaths(body, exclude) {
  const seen = new Set();
  for (const m of body.matchAll(/`([\w./-]+\.(?:[jt]sx?|mjs|cjs|json|py|go|rs))`/g)) {
    const p = m[1].replace(/^\.\//, '');
    if (p !== exclude) seen.add(p);
  }
  for (const m of body.matchAll(/\b(demo-repo\/[\w-]+)\b/g)) seen.add(m[1] + '/');
  return [...seen].map(p => ({ path: p, ...mapPath(p) }));
}

function downstreamSection(body) {
  const m = /downstream impact[\s\S]*?(?:\n#{1,6}\s|\n\s*$|$)/i.exec(body);
  return m ? mentionedPaths(m[0]) : [];
}

const isGreptile = c => GREPTILE_LOGINS.has(c.user && c.user.login);

async function buildReport(gh, repo, prNumber, prMeta) {
  const [pr, files, reviewComments, issueComments, reviews] = await Promise.all([
    prMeta || gh(`/repos/${repo}/pulls/${prNumber}`),
    gh(`/repos/${repo}/pulls/${prNumber}/files`),
    gh(`/repos/${repo}/pulls/${prNumber}/comments`),
    gh(`/repos/${repo}/issues/${prNumber}/comments`),
    gh(`/repos/${repo}/pulls/${prNumber}/reviews`),
  ]);

  const findings = reviewComments.filter(isGreptile).map(c => ({
    path: c.path, line: c.line ?? c.original_line ?? null,
    severity: parseSeverity(c.body), body: c.body, url: c.html_url, createdAt: c.created_at,
    ...mapPath(c.path), mentions: mentionedPaths(c.body, c.path),
  }));
  const summaries = [...issueComments.filter(isGreptile), ...reviews.filter(isGreptile).filter(r => r.body)];
  const downstream = summaries.flatMap(c => downstreamSection(c.body));

  const outFiles = files.map(f => ({
    path: f.filename, additions: f.additions, deletions: f.deletions, status: f.status,
    patch: f.patch || null, ...mapPath(f.filename),
  }));

  function aggregate(level) {
    const acc = {};
    const touch = id => (acc[id] ??= { files: [], findings: 0, maxSeverity: null, add: 0, del: 0, downstream: false });
    for (const f of outFiles) if (f[level]) { const n = touch(f[level]); n.files.push(f.path); n.add += f.additions; n.del += f.deletions; }
    for (const fd of findings) {
      const ids = new Set([fd[level], ...fd.mentions.map(m => m[level])].filter(Boolean));
      for (const id of ids) {
        const n = touch(id); n.findings++;
        if (!n.maxSeverity || SEV_ORDER.indexOf(fd.severity) > SEV_ORDER.indexOf(n.maxSeverity)) n.maxSeverity = fd.severity;
      }
    }
    for (const d of downstream) if (d[level]) touch(d[level]).downstream = true;
    return acc;
  }

  return {
    generatedFrom: 'greptile', repo,
    pr: {
      id: `#${prNumber}`, number: prNumber, title: pr.title, author: pr.user && pr.user.login, url: pr.html_url,
      head: pr.head && pr.head.sha, headRef: pr.head && pr.head.ref, base: pr.base && pr.base.ref, state: pr.state,
      merged: Boolean(pr.merged_at), updatedAt: pr.updated_at, labels: (pr.labels || []).map(l => l.name),
    },
    greptileReviewed: findings.length + summaries.length > 0,
    files: outFiles, findings,
    summary: { body: summaries.map(c => c.body).join('\n\n---\n\n'), downstream },
    impact: { arch: aggregate('arch'), mod: aggregate('mod') },
    unmapped: outFiles.filter(f => !f.arch).map(f => f.path),
  };
}

module.exports = { makeClient, buildReport, mapPath, readDotEnv, GREPTILE_LOGINS };
