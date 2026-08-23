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

module.exports = { buildReverseAdj, computeBlastRadius };
