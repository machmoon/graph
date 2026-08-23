#!/usr/bin/env node
// Pulls Greptile's review of a PR back out of GitHub and converts it into a
// node-keyed report for blast-radius.html.
//
// Usage:
//   GITHUB_TOKEN=... node scripts/greptile-report.mjs <pr-number> [owner/repo]
//
// Output: reports/<pr>.json
//   {
//     pr: { id:'#123', title, author, url, head, base },
//     files: [{ path, additions, deletions, arch, mod }],
//     findings: [{ path, line, severity, body, arch, mod, mentions:[{path, arch, mod}] }],
//     summary: { body, downstream:[{path, arch, mod}] },
//     impact: { arch: { <nodeId>: { files:[], findings:n, maxSeverity, add, del } }, mod: {...} }
//   }

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [prArg, repoArg] = process.argv.slice(2);
if (!prArg) { console.error('usage: greptile-report.mjs <pr-number> [owner/repo]'); process.exit(1); }
const REPO = repoArg || process.env.GITHUB_REPOSITORY || 'machmoon/graph';
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (!TOKEN) { console.error('GITHUB_TOKEN is required'); process.exit(1); }
const PR = Number(prArg);

const GREPTILE_LOGINS = new Set(['greptile-apps[bot]', 'greptile-apps', 'greptile[bot]', 'greptileai']);
const SEV_ORDER = ['low', 'medium', 'high', 'critical'];

// ── GitHub API ───────────────────────────────────────────────
async function gh(path) {
  const out = [];
  let url = `https://api.github.com${path}${path.includes('?') ? '&' : '?'}per_page=100`;
  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}: ${await res.text()}`);
    const data = await res.json();
    if (!Array.isArray(data)) return data;
    out.push(...data);
    const next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') || '');
    url = next ? next[1] : null;
  }
  return out;
}

// ── Mapping ──────────────────────────────────────────────────
const MAP = JSON.parse(readFileSync(join(ROOT, 'scripts/component-map.json'), 'utf8')).rules;
function mapPath(p) {
  if (!p) return { arch: null, mod: null };
  const rule = MAP.find(r => p.startsWith(r.prefix));
  return rule ? { arch: rule.arch || null, mod: rule.mod || null } : { arch: null, mod: null };
}

// ── Parsing Greptile comment bodies ──────────────────────────
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
    if (p !== exclude && !seen.has(p)) seen.add(p);
  }
  // Directory-level mentions such as demo-repo/order-service
  for (const m of body.matchAll(/\b(demo-repo\/[\w-]+)\b/g)) {
    const p = m[1] + '/';
    if (!seen.has(p)) seen.add(p);
  }
  return [...seen].map(p => ({ path: p, ...mapPath(p) }));
}
function downstreamSection(body) {
  const m = /downstream impact[\s\S]*?(?:\n#{1,6}\s|\n\s*$|$)/i.exec(body);
  return m ? mentionedPaths(m[0]) : [];
}
const isGreptile = c => GREPTILE_LOGINS.has(c.user?.login);

// ── Main ─────────────────────────────────────────────────────
const [pr, files, reviewComments, issueComments, reviews] = await Promise.all([
  gh(`/repos/${REPO}/pulls/${PR}`),
  gh(`/repos/${REPO}/pulls/${PR}/files`),
  gh(`/repos/${REPO}/pulls/${PR}/comments`),
  gh(`/repos/${REPO}/issues/${PR}/comments`),
  gh(`/repos/${REPO}/pulls/${PR}/reviews`),
]);

const gFindings = reviewComments.filter(isGreptile).map(c => ({
  path: c.path, line: c.line ?? c.original_line ?? null,
  severity: parseSeverity(c.body), body: c.body, url: c.html_url,
  ...mapPath(c.path), mentions: mentionedPaths(c.body, c.path),
}));
const gSummaries = [...issueComments.filter(isGreptile), ...reviews.filter(isGreptile).filter(r => r.body)];
const summaryBody = gSummaries.map(c => c.body).join('\n\n---\n\n');
const downstream = gSummaries.flatMap(c => downstreamSection(c.body));

const outFiles = files.map(f => ({ path: f.filename, additions: f.additions, deletions: f.deletions, status: f.status, ...mapPath(f.filename) }));

function aggregate(level) {
  const acc = {};
  const touch = id => (acc[id] ??= { files: [], findings: 0, maxSeverity: null, add: 0, del: 0, downstream: false });
  for (const f of outFiles) if (f[level]) { const n = touch(f[level]); n.files.push(f.path); n.add += f.additions; n.del += f.deletions; }
  for (const fd of gFindings) {
    const ids = new Set([fd[level], ...fd.mentions.map(m => m[level])].filter(Boolean));
    for (const id of ids) {
      const n = touch(id); n.findings++;
      if (!n.maxSeverity || SEV_ORDER.indexOf(fd.severity) > SEV_ORDER.indexOf(n.maxSeverity)) n.maxSeverity = fd.severity;
    }
  }
  for (const d of downstream) if (d[level]) touch(d[level]).downstream = true;
  return acc;
}

const report = {
  generatedFrom: 'greptile', repo: REPO,
  pr: { id: `#${PR}`, number: PR, title: pr.title, author: pr.user?.login, url: pr.html_url, head: pr.head?.sha, base: pr.base?.ref, state: pr.state },
  greptileReviewed: gFindings.length + gSummaries.length > 0,
  files: outFiles, findings: gFindings,
  summary: { body: summaryBody, downstream },
  impact: { arch: aggregate('arch'), mod: aggregate('mod') },
  unmapped: outFiles.filter(f => !f.arch).map(f => f.path),
};

mkdirSync(join(ROOT, 'reports'), { recursive: true });
const outPath = join(ROOT, 'reports', `${PR}.json`);
writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`wrote ${outPath}: ${outFiles.length} files, ${gFindings.length} Greptile findings, ${gSummaries.length} summary comments${report.greptileReviewed ? '' : ' (Greptile has not reviewed this PR yet)'}`);
if (report.unmapped.length) console.log(`unmapped paths (add rules to scripts/component-map.json): ${report.unmapped.join(', ')}`);
