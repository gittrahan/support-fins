// UNSERVED must count dropped overhangs, not hide them. buildFins used to report
// `unserved - wedged PATCHES`: a patch count off a region count (two different
// segmentations), so wedges under one region hid others that nothing supports.
// Credit is spatial now (fins.js unservedAfterWedges): a region is served when a
// wall stands under it or a wedge vertex sits just under one of its faces.
import { loadModel, analyze, fins, assert, rotX, rotY } from './_util.js';

const mul = (a, b) => {           // 3x3 col-major, as prototype/stress/run.js
  const m = new Array(9).fill(0);
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++)
    for (let k = 0; k < 3; k++) m[c * 3 + r] += a[k * 3 + r] * b[c * 3 + k];
  return m;
};
const build = (name, rot, coverage) => {
  const topo = loadModel(name);
  return fins.buildFins(topo, analyze(topo, 45, rot), rot, { mode: 'auto', bedPad: true, tines: true, coverage });
};

Deno.test('unserved: regions no support reaches are reported (lowledge X30Y60, dense)', () => {
  // Both overhang regions have no support vertex within reach (0% covered); two
  // wedges elsewhere used to cancel them out -> "1 unserved".
  const b = build('lowledge', mul(rotY(60), rotX(30)), 1);
  assert(b.unserved === 2, `dropped overhangs hidden: unserved ${b.unserved}, expected 2`);
});

Deno.test('unserved: a region a wedge stands under counts as served (plate X60)', () => {
  // The wedge covers the plate's whole underside but shares no faces with the
  // overhang region -- credit must be spatial, not by face set.
  const b = build('plate', rotX(60), 0.5);
  assert(b.unserved === 0, `wedged region reported unserved: ${b.unserved}`);
});
