// SPDX-License-Identifier: GPL-3.0-or-later
// Blender presentation adapter. Candidate generation, seating and load assessment
// all come from the current web engine; no copied/private geometry implementation.
import { analyze } from './web/overhangs.js';
import { suggestOrientations, suggestStrengthPose, loadAlignment } from './web/orient.js';

const rotate = (r, v) => [0, 1, 2].map(i =>
  r[i] * v[0] + r[i + 3] * v[1] + r[i + 6] * v[2]);

export function orientationCandidates(topo, dir, {threshold = 45, strength = false} = {}) {
  const loaded = dir && Math.hypot(...dir) > 1e-9;
  const ordinary = suggestOrientations(topo, {threshold, top: 6});
  const strong = loaded ? suggestStrengthPose(topo, dir, {threshold}) : null;
  const raw = [...ordinary.candidates];
  if (strong) raw.push(strong);
  const unique = [];
  for (const candidate of raw) {
    // Ignore yaw-equivalent poses: these have the same down face.
    if (unique.some(q => [2, 5, 8].reduce((sum, i) =>
      sum + q.rot[i] * candidate.rot[i], 0) > .9999)) continue;
    const a = analyze(topo, threshold, candidate.rot);
    if (a.bedArea < 1) continue;
    const printCost = a.overArea + Math.max(0, 200 - a.bedArea) * .25 + a.size.z * 2;
    unique.push({...candidate, height: a.size.z, size: a.size, bedArea: a.bedArea,
      overArea: a.overArea, regions: a.regions.length, printCost,
      load: loaded ? loadAlignment(rotate(candidate.rot, dir)) : null});
  }
  const scale = Math.max(60, Math.min(...unique.map(c => c.printCost)) + 60);
  unique.sort((a, b) => {
    if (strength && strong) {
      const same = c => [2, 5, 8].reduce((s, i) => s + c.rot[i] * strong.rot[i], 0) > .9999;
      if (same(a) !== same(b)) return same(a) ? -1 : 1;
    }
    return (a.printCost / scale + (a.load?.cross ?? 0) * 3)
      - (b.printCost / scale + (b.load?.cross ?? 0) * 3);
  });
  return {candidates: unique.slice(0, 3), confidence: ordinary.confidence};
}
