// Squat bed props: near-bed overhangs too low for a flanged breakaway wall.
//
// A full T-wall needs ~minHeight of headroom just to exist (gap + base flange +
// tip taper), so before this the sub-minHeight stations of a low overhang were
// trimmed as stub/blocked and the ledge printed into air -- the near-bed band on
// real organic parts that came out rough. `lowledge` is that case distilled: a
// thin tongue whose underside sits ~1mm above the plate. These lock the promise
// that it now gets a FLANGELESS squat wall that (a) actually appears, (b) stays
// squat, (c) is watertight, and (d) never fuses into the part.

import { prop, analyze, loadModel, fins, insideCount, isClosed, rotX, assert } from './_util.js';

const FLAT = rotX(0);

function build(opts = {}) {
  const topo = loadModel('lowledge');
  const res = analyze(topo, 45, FLAT);
  const built = prop.buildProps(topo, res, FLAT, { coverage: 0.25, tines: true, ...opts });
  return { topo, res, built };
}

Deno.test('lowledge: the near-bed overhang gets a squat prop it did not before', () => {
  const { built } = build();
  const squat = built.props.filter((p) => p.squat);
  assert(squat.length >= 1, `no squat props placed (props ${built.props.length})`);
});

Deno.test('lowledge: a squat prop stays squat -- between the squat floor and minHeight', () => {
  const { built } = build();
  for (const p of built.props.filter((q) => q.squat)) {
    assert(p.height >= prop.PROP.minHeightSquat - 1e-6 && p.height < prop.PROP.minHeight,
      `squat prop height ${p.height.toFixed(2)} outside [${prop.PROP.minHeightSquat}, ${prop.PROP.minHeight})`);
  }
});

Deno.test('lowledge: squat support is watertight', () => {
  const { built } = build();
  assert(isClosed(built.triangles), 'squat support geometry is not closed');
});

Deno.test('lowledge: a squat wall stands on a brim wider than the wall, for plate grip', () => {
  const { built } = build({ tines: false }); // walls + brims, no tines
  // Effective plate-contact width = (plate-contact area) / (total wall length).
  // A brimmed wall gives ~2*squatBrimW; a bare tip contact would give only `tip`
  // and peel off the bed. lowledge is all-squat, so the z~0 area is brim alone.
  let plateArea = 0;
  for (let i = 0; i < built.triangles.length; i += 3) {
    const a = built.triangles[i], b = built.triangles[i + 1], c = built.triangles[i + 2];
    if (a[2] < 0.02 && b[2] < 0.02 && c[2] < 0.02) {
      plateArea += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
    }
  }
  const wallLen = built.props.filter((p) => p.squat).reduce((s, p) => s + p.span, 0);
  const width = plateArea / wallLen;
  assert(width > prop.PROP.th,
    `brim only ${width.toFixed(2)}mm wide (tip is ${prop.PROP.tip}, wall th ${prop.PROP.th}) -- would peel`);
});

Deno.test('lowledge: the squat WALL never fuses into the part', () => {
  const { topo, res, built } = build({ tines: false }); // walls only; only tines may bite
  const inside = insideCount(topo, FLAT, res.offset, built.triangles);
  assert(inside === 0, `${inside} squat-wall verts are inside the STL (it should clear the part by the gap)`);
});

Deno.test('lowledge: the end-to-end fins path surfaces the squat wall too', () => {
  const topo = loadModel('lowledge');
  const res = analyze(topo, 45, FLAT);
  const built = fins.buildFins(topo, res, FLAT, { mode: 'auto', bedPad: true, tines: true });
  assert(isClosed(built.triangles), 'fins-path support geometry is not closed');
  assert(built.braceCount >= 1, `no supports placed via buildFins (braceCount ${built.braceCount})`);
});
