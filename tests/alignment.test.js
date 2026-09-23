// `opts.alignment` -- biases where walls sit laterally across a flat overhang:
// center (default) | near edge | far edge | both edges. Issue #25 (b): "align
// fin support in the middle or along one/two edges of a flat surface."
//
// Pins: center is byte-identical to unset (default unchanged); near and far
// shift the walls off the centred positions to OPPOSITE edges; both pins both
// edges (wider spread, >= 2 walls). The "box on a 45deg edge" surface is
// already detected as a patch; this only biases the lateral (cross-slope)
// position of each wall, never its run or height.

import { tiltedBlockTopo, analyze, fins, assert, assertClose } from './_util.js';

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

// A broad tilted plate whose overhang is a wide flat patch that takes a ROW of
// prop walls -- the only place alignment bites (a narrow part keeps a single
// brace). 40deg tilt / 45deg threshold makes the broad bottom face the
// overhang, which `patchTracks` lines with centred rows by default.
function plate() {
  const topo = tiltedBlockTopo(-40, 40, -45, 45, -6, 6, 40);
  return { topo, res: analyze(topo, 45, IDENTITY) };
}

// The lateral (cross-run) coordinate of each wall's centerline. A wall running
// along Y has constant X; one along X has constant Y. Pick the axis with the
// smaller extent (the wall is thin across it) and return its midpoint.
function lats(alignment) {
  const { topo, res } = plate();
  const b = fins.buildFins(topo, res, IDENTITY,
    { mode: 'auto', bedPad: true, tines: true, coverage: 0.5, alignment });
  const out = [];
  for (const p of b.props) {
    const line = p.line;
    if (!line || !line.length) continue;
    const xs = line.map((q) => q[0]), ys = line.map((q) => q[1]);
    const xExt = Math.max(...xs) - Math.min(...xs);
    const yExt = Math.max(...ys) - Math.min(...ys);
    out.push(xExt >= yExt
      ? (Math.min(...ys) + Math.max(...ys)) / 2
      : (Math.min(...xs) + Math.max(...xs)) / 2);
  }
  return out;
}
const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);

Deno.test('alignment: center is the default (unset == "center")', () => {
  const unset = lats(undefined), center = lats('center');
  assert(unset.length === center.length && unset.length > 0, 'unset vs center differ or produced no walls');
  for (let i = 0; i < unset.length; i++) assertClose(unset[i], center[i], 1e-9, 'unset != center');
});

Deno.test('alignment: near/far shift walls to opposite edges; both pins both', () => {
  const center = lats('center'), near = lats('near'), far = lats('far'), both = lats('both');
  assert(near.length && far.length && both.length, 'an alignment produced no walls');
  const cM = mean(center), nM = mean(near), fM = mean(far);
  // near and far move OFF the centred mean, in OPPOSITE directions. Which label
  // maps to which physical edge is a convention; the pin is that they diverge,
  // so the slider actually repositions walls and is not inert.
  assert(Math.abs(nM - cM) > 1, `near did not move off centre (${nM.toFixed(2)} vs ${cM.toFixed(2)})`);
  assert(Math.abs(fM - cM) > 1, `far did not move off centre (${fM.toFixed(2)} vs ${cM.toFixed(2)})`);
  assert((nM - cM) * (fM - cM) < 0, 'near and far did not move to opposite edges');
  // both edges spans at least the centred spread -- it pins the two extremes.
  const cRange = Math.max(...center) - Math.min(...center);
  const bRange = Math.max(...both) - Math.min(...both);
  assert(bRange >= cRange - 0.01, `both did not span wider than centre (${bRange.toFixed(2)} vs ${cRange.toFixed(2)})`);
});

Deno.test('alignment: both edges yields at least two walls', () => {
  assert(lats('both').length >= 2, 'both edges yielded fewer than 2 walls');
});
