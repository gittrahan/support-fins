// UNSERVED must count dropped overhangs, not hide them. buildFins used to report
// `unserved - wedged PATCHES`: a patch count off a region count (two different
// segmentations), so wedges under one region hid others that nothing supports.
// Credit is spatial now (fins/wedges.js unservedAfterWedges): a region is served when a
// wall stands under it or a wedge vertex sits just under one of its faces.
import { loadModel, analyze, fins, assert, rotX, rotY } from './_util.js';

const { heldRegions } = await import('../web/fins/fill.js');

const mul = (a, b) => {           // 3x3 col-major, as prototype/stress/run.js
  const m = new Array(9).fill(0);
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++)
    for (let k = 0; k < 3; k++) m[c * 3 + r] += a[k * 3 + r] * b[c * 3 + k];
  return m;
};
const build = (name, rot, coverage, mode = 'auto') => {
  const topo = loadModel(name);
  return fins.buildFins(topo, analyze(topo, 45, rot), rot, { mode, bedPad: true, tines: true, coverage });
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

// Full coverage's `unserved` was Auto's: withFill builds Full as { ...auto } plus the
// fill's walls, so the torus flat on the plate read "40 walls, 121 tines; 2 overhangs
// are too shallow for a fin this way up" in every plugin, and Orca named a tilt for it.
Deno.test('unserved: Full coverage counts a region its fill walls hold as served (torus flat)', () => {
  const auto = build('torus', rotX(0), 0.5);
  const full = build('torus', rotX(0), 0.5, 'full');
  assert(auto.unserved === 2, `precondition: Auto leaves the torus's inner ceilings bare, unserved ${auto.unserved}`);
  assert(full.fill.walls > 0, 'precondition: Full adds walls under them');
  assert(full.unserved === 0, `Full reports ${full.unserved} overhangs too shallow under its ${full.fill.walls} fill walls`);
});

Deno.test('unserved: a fill wall that holds none of a region does not serve it', () => {
  const topo = loadModel('torus'), rot = rotX(0), res = analyze(topo, 45, rot);
  const full = fins.buildFins(topo, res, rot, { mode: 'full', bedPad: true, tines: true, coverage: 0.5 });
  const added = full.fins.filter((f) => f.fill);
  const bare = res.regions.map((_, i) => i);
  const auto = { fins: full.fins.filter((f) => !f.fill) };
  assert(heldRegions(topo, res, rot, { coverage: 0.5 }, auto, added, bare).length === 2, 'the fill walls hold both regions');
  // the same walls 200 mm off the part hold nothing, and nothing held is nothing served
  const away = added.map((f) => ({ ...f, line: f.line.map(([x, y, z]) => [x + 200, y, z]) }));
  assert(heldRegions(topo, res, rot, { coverage: 0.5 }, auto, away, bare).length === 0, 'walls off the part served a region');
  assert(heldRegions(topo, res, rot, { coverage: 0.5 }, auto, [], bare).length === 0, 'no walls served a region');
});
