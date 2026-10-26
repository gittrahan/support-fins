import { PLATE_Z, MUST } from '../../web/fins/coverage.js';
import { PROP, surfaceZAt } from '../../web/prop.js';
import { faceSamples, partAnchors, scorer } from '../../web/prop/judge.js';
import { classify } from './held.js';

/**
 * The 062 judge over a whole build, for probe.js: web/prop/judge.js (the races'
 * ruler -- the rule is described there) over every MUST-hold overhang face
 * (held.js classify), plus what only a finished build has: the plate and the bed
 * pad hold what sits on them.
 *
 * Returns areas by class -- `plate`, `near`, `bridged` (held), `cant` (a bare
 * cantilever held.js would have counted held), `bare` -- with `must`, `held` and
 * `pct`; `faces` lists the samples' classes for plotting, `anchors.edges` the part
 * anchors.
 */
export function judge(topo, res, rot, build) {
  const partPts = partAnchors(topo, res, rot);
  const held = scorer((build.fins ?? []).map((w) => w.line ?? []), partPts);
  const cls = classify(topo, res, rot);
  const onPad = padUnder(build.padTriangles);
  const out = { must: 0, held: 0, plate: 0, near: 0, bridged: 0, bare: 0, cant: 0, faces: [] };
  for (let f = 0; f < topo.nFaces; f++) {
    if (!res.over[f] || cls[f] !== MUST) continue;
    out.must += topo.area[f];
    for (const [x, y, z, w] of faceSamples(topo, res, rot, f)) {
      const c = z < PLATE_Z || onPad(x, y, z) ? 'plate' : held(x, y, z);
      out[c] += w;
      if (c !== 'cant' && c !== 'bare') out.held += w;
      if (out.faces.length < 200000) out.faces.push([f, c, +x.toFixed(2), +y.toFixed(2), +z.toFixed(2)]);
    }
  }
  out.anchors = { edges: partPts };
  out.pct = out.must ? (100 * out.held) / out.must : null;
  return out;
}

function padUnder(pad) {
  if (!pad?.length) return () => false;
  const flip = new Float64Array(pad.length * 3);
  const reach = PROP.gap + 0.3;
  pad.forEach((v, i) => { flip[i * 3] = v[0]; flip[i * 3 + 1] = v[1]; flip[i * 3 + 2] = -v[2]; });
  return (x, y, z) => {
    const m = surfaceZAt(flip, x, y);
    return m !== null && z + m <= reach;
  };
}
