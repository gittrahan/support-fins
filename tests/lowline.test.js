// `opts.traceLowestLine` + `lowestLine` -- the opt-in that swaps `tubeLine`
// for its curvature-gate-free generalisation, so a FLAT overhang (a box
// tipped on edge) also gets ONE wall down its lowest line instead of parallel
// rows. Issue #25 (a): "trace one uninterrupted fin along the object's lowest
// points for the length of the object."
//
// Pins: (1) directly, `lowestLine` returns a straight line on a flat region
// where `tubeLine` returns null (the curvature gate refuses it); (2) in the
// full build, the option routes flat regions through `lowestLine` -- a traced
// wall is attempted (reported `blocked` on this steep part, since the body
// sits under the low edge) where the rows path reports `stub`; (3) with the
// option off, behaviour is byte-identical to unset -- the default is unchanged.

import { tiltedBlockTopo, analyze, prop, fins, assert, assertClose } from './_util.js';

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

// A block tipped 50deg about X: its -Y face is a FLAT overhang (narrow, long)
// whose lowest points form a straight line along X for the length of the part.
// `tubeLine` refuses it (not curved enough); `lowestLine` traces it. This is
// the "box on a 45deg edge" lowest-line case from the issue.
function flatEdgeRegion() {
  const topo = tiltedBlockTopo(-40, 40, -45, 45, -6, 6, 50);
  const res = analyze(topo, 45, IDENTITY);
  const rf = res.regions[0].faces, o = res.offset, p = topo.pos;
  const seat = (idx) => [p[idx] + o.x, p[idx + 1] + o.y, p[idx + 2] + o.z];
  const tris = new Float64Array(rf.length * 9);
  const pts = [];
  for (let k = 0; k < rf.length; k++) {
    let gx = 0, gy = 0, gz = 0;
    for (let i = 0; i < 3; i++) {
      const w = seat(rf[k] * 9 + i * 3);
      tris[k * 9 + i * 3] = w[0]; tris[k * 9 + i * 3 + 1] = w[1]; tris[k * 9 + i * 3 + 2] = w[2];
      pts.push(w); gx += w[0]; gy += w[1]; gz += w[2];
    }
    pts.push([gx / 3, gy / 3, gz / 3]); // face centroid, as buildProps does
  }
  return { topo, faces: rf, pts, tris };
}

Deno.test('lowline: tubeLine refuses a flat region, lowestLine traces it', () => {
  const { topo, faces, pts, tris } = flatEdgeRegion();
  const tube = prop.tubeLine(topo, faces, IDENTITY, pts, tris);
  assert(!tube || !tube.length, 'tubeLine traced a flat region (curvature gate gone)');
  const low = prop.lowestLine(topo, faces, IDENTITY, pts, tris);
  assert(low && low.length >= 1, 'lowestLine returned no line on a flat region');
  const line = low[0];
  assert(line.length >= 3, 'traced line too short');
  // spans the long (X) axis -- "for the length of the object"
  const xs = line.map((p) => p[0]);
  assert(Math.max(...xs) - Math.min(...xs) > 50, 'line does not span the object\'s length');
  // a straight low-edge line: Y is (near) constant along it
  const ys = line.map((p) => p[1]);
  assert(Math.max(...ys) - Math.min(...ys) < 1, 'line is not straight along the low edge');
});

Deno.test('lowline: the option routes flat regions through lowestLine in the build', () => {
  const topo = tiltedBlockTopo(-40, 40, -45, 45, -6, 6, 50);
  const res = analyze(topo, 45, IDENTITY);
  const off = fins.buildFins(topo, res, IDENTITY,
    { mode: 'auto', bedPad: true, tines: true, coverage: 0.5, traceLowestLine: false });
  const on = fins.buildFins(topo, res, IDENTITY,
    { mode: 'auto', bedPad: true, tines: true, coverage: 0.5, traceLowestLine: true });
  // OFF: the flat region falls to rows and is refused as `stub` (a wedge then
  // serves it). ON: lowestLine traces a line and a wall is attempted -- shown
  // as `blocked` here because the part body sits under this steep face's low
  // edge. The reason DIFFERING is the signal the option engaged: the rows path
  // never produces a `blocked` wall, only the lowestLine path does.
  assert(off.skipped.blocked === 0, 'off build had a blocked wall (lowestLine not gated off)');
  assert(on.skipped.blocked >= 1, 'on build did not trace a lowestLine wall (no blocked)');
});

Deno.test('lowline: off / unset are byte-identical (default behaviour unchanged)', () => {
  const topo = tiltedBlockTopo(-40, 40, -45, 45, -6, 6, 50);
  const res = analyze(topo, 45, IDENTITY);
  const unset = fins.buildFins(topo, res, IDENTITY,
    { mode: 'auto', bedPad: true, tines: true, coverage: 0.5 });
  const off = fins.buildFins(topo, res, IDENTITY,
    { mode: 'auto', bedPad: true, tines: true, coverage: 0.5, traceLowestLine: false });
  assert(unset.props.length === off.props.length, 'traceLowestLine:false changed the default count');
  for (let i = 0; i < off.props.length; i++) {
    const a = unset.props[i].line, b = off.props[i].line;
    assert(a.length === b.length, 'line station count changed with option off');
    for (let k = 0; k < a.length; k++)
      for (let j = 0; j < 3; j++)
        assertClose(a[k][j], b[k][j], 1e-9, 'traceLowestLine off shifted a station');
  }
});
