const { execSync } = require('child_process');
const path = require('path');

function parseDiffStat(repoPath, baseBranch = 'main', headBranch = 'HEAD') {
  const raw = execSync(
    `git diff --numstat ${baseBranch}...${headBranch}`,
    { cwd: repoPath, encoding: 'utf-8' }
  );
  const files = [];
  for (const line of raw.trim().split('\n')) {
    if (!line) continue;
    const [add, del, file] = line.split('\t');
    files.push({ file, add: parseInt(add) || 0, del: parseInt(del) || 0 });
  }
  return files;
}

function parsePatchFiles(repoPath, baseBranch = 'main', headBranch = 'HEAD') {
  const raw = execSync(
    `git diff --name-only ${baseBranch}...${headBranch}`,
    { cwd: repoPath, encoding: 'utf-8' }
  );
  return raw.trim().split('\n').filter(Boolean);
}

function mapFilesToGroups(changedFiles, fileToGroup) {
  const affected = {};
  for (const entry of changedFiles) {
    const file = typeof entry === 'string' ? entry : entry.file;
    const group = fileToGroup[file];
    if (!group) continue;
    if (!affected[group]) affected[group] = { files: [], add: 0, del: 0 };
    affected[group].files.push(file);
    if (entry.add !== undefined) {
      affected[group].add += entry.add;
      affected[group].del += entry.del;
    }
  }
  return affected;
}

// Teammates: plug in LLM call here to generate summaries per component
function generateSummary(groupId, files) {
  return `${files.length} file(s) changed in ${groupId}`;
}

module.exports = { parseDiffStat, parsePatchFiles, mapFilesToGroups, generateSummary };
