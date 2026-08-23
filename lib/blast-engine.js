function buildReverseAdj(edges) {
  const rev = {};
  for (const [from, to] of edges) {
    if (!rev[to]) rev[to] = [];
    rev[to].push(from);
  }
  return rev;
}

function computeBlastRadius(directChanges, edges) {
  const rev = buildReverseAdj(edges);
  const dist = {};
  const queue = [];

  for (const id of directChanges) {
    dist[id] = 0;
    queue.push(id);
  }

  while (queue.length) {
    const curr = queue.shift();
    for (const dep of (rev[curr] || [])) {
      if (dist[dep] === undefined) {
        dist[dep] = dist[curr] + 1;
        queue.push(dep);
      }
    }
  }

  const direct = new Set(directChanges);
  const indirect = Object.keys(dist).filter(id => !direct.has(id));
  const maxHop = Math.max(0, ...Object.values(dist));

  const hops = [];
  for (let h = 0; h <= maxHop; h++) {
    hops.push(Object.entries(dist).filter(([, d]) => d === h).map(([id]) => id));
  }

  return { dist, direct: [...direct], indirect, hops, maxHop };
}

// Mass-conserving blast radius.
//
// computeBlastRadius answers "is this reachable", which on a dense graph is
// always yes. This answers "how much of the change actually lands here".
//
// Each changed node starts with mass 1 and splits it among its dependents at
// every hop, so a hub with 20 dependents gives each 1/20 while a narrow chain
// passes ~1.0 through. Total mass is conserved, so the blast gets THINNER as it
// spreads instead of larger. Nodes under `minMass` are dropped entirely.
//
// A flat distribution (every dependent at the same low mass) is itself a
// finding: the change is diffuse and file-level imports cannot localise it.
function computeWeightedBlast(directChanges, edges, opts = {}) {
  const { decay = 1.0, minMass = 0.02 } = opts;
  const rev = buildReverseAdj(edges);

  const mass = {};
  const dist = {};
  const seen = new Set(directChanges);
  for (const id of directChanges) {
    mass[id] = 1;
    dist[id] = 0;
  }

  let frontier = [...directChanges];
  let hop = 0;

  while (frontier.length) {
    hop++;
    const next = new Map();

    for (const curr of frontier) {
      const deps = rev[curr] || [];
      if (!deps.length) continue;
      const share = (mass[curr] * decay) / deps.length;
      for (const dep of deps) {
        if (seen.has(dep)) continue;
        next.set(dep, (next.get(dep) || 0) + share);
      }
    }

    const admitted = [];
    for (const [dep, m] of next) {
      if (m < minMass) continue;
      mass[dep] = m;
      dist[dep] = hop;
      seen.add(dep);
      admitted.push(dep);
    }
    frontier = admitted;
  }

  const direct = new Set(directChanges);
  const ranked = Object.entries(mass)
    .filter(([id]) => !direct.has(id))
    .map(([id, m]) => ({ id, mass: m, hop: dist[id] }))
    .sort((a, b) => b.mass - a.mass);

  // Spread: 1 = one dependent absorbs everything, 0 = perfectly diffuse.
  const total = ranked.reduce((s, r) => s + r.mass, 0);
  const concentration = total > 0 ? ranked[0].mass / total : 0;

  return { mass, dist, ranked, concentration, pruned: true };
}

module.exports = { buildReverseAdj, computeBlastRadius, computeWeightedBlast };
