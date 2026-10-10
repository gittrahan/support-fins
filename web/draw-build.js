/** Ordered placement and assembly, shared by the worker and geometry tests. */
import { applyTunables } from './fins.js';
import { drawnWall } from './draw.js';
import { swayAtFace } from './sway.js';
import { seatedPartTris } from './fins/seating.js';

export function buildDrawn(topo, result, rot, requests, options, avoid = {}, partTris = null, candidates = null) {
  applyTunables(options.tunables);
  const tris = partTris ?? seatedPartTris(topo, rot, result.offset);
  const triangles = [], items = [], braces = [...(avoid.braces ?? [])];
  for (let i = 0; i < requests.length; i++) {
    const w = requests[i];
    const r = w.kind === 'sway'
      ? swayAtFace(topo, result, rot, w.face, w.a, options.sway, { braces, walls: avoid.walls ?? [] })
      : candidates?.[i] ?? drawnWall(w.a, w.b, tris, 0, { ...options.draw, topo, rot, offset: result.offset });
    const triStart = triangles.length / 3;
    if (r.ok) {
      if (w.kind === 'sway') braces.push(r);
      for (const t of r.tris) triangles.push(t);
    }
    const info = { ...r };
    delete info.tris; // The range owns the soup; don't clone every wall twice.
    items.push({ ok: r.ok, info, triStart, triEnd: triangles.length / 3 });
  }
  return { items, triangles };
}
