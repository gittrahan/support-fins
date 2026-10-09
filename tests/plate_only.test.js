// PLATE ONLY (#218): every support stands on the build plate, none on the part. A
// line with part under it is dropped and counted (skipped.onPart), never stilted to
// the plate through that part; a drawn line there is refused with the reason.
import { WEB, block, fins, analyze, loadModel, rotY, assert } from './_util.js';

const { drawnWall } = await import(`${WEB}draw.js`);

// an L: a base block (top z=5) and a shelf 30 mm above it -- a wall under the shelf
// stands on the base
const L = new Float32Array([...block(-40, 40, -10, 10, 0, 5), ...block(-40, 40, -10, 10, 35, 39)]);
// the shelf alone, over open plate
const SHELF = new Float32Array(block(-40, 40, -10, 10, 35, 39));

Deno.test('plate only: a drawn line with part under it is refused, with the reason', () => {
  const on = drawnWall([-30, 0, 35], [30, 0, 35], L, 0);
  assert(on.ok && on.partAttached, 'without Plate only the wall stands on the base');
  const r = drawnWall([-30, 0, 35], [30, 0, 35], L, 0, { plateOnly: true });
  assert(!r.ok, 'Plate only built a wall over the part');
  assert(/Plate only/.test(r.reason), `reason doesn't name the setting: ${r.reason}`);
});

Deno.test('plate only: a drawn line over open plate builds the same wall', () => {
  const a = drawnWall([-30, 0, 35], [30, 0, 35], SHELF, 0);
  const b = drawnWall([-30, 0, 35], [30, 0, 35], SHELF, 0, { plateOnly: true });
  assert(a.ok && b.ok && !b.partAttached, 'the plate wall should build either way');
  assert(JSON.stringify(a.tris) === JSON.stringify(b.tris), 'Plate only changed a plate wall');
});

// the portal on its side (Y90): Auto stands its one wall on the lower leg
const portal = () => {
  const topo = loadModel('portal'), rot = rotY(90);
  return { topo, rot, res: analyze(topo, 45, rot) };
};

for (const mode of ['auto', 'full']) {
  Deno.test(`plate only: ${mode} builds nothing on the part, and counts what it left`, () => {
    const { topo, rot, res } = portal();
    const base = fins.buildFins(topo, res, rot, { mode, bedPad: true });
    assert(base.props.some((q) => q.partAttached), `${mode}: the fixture lost its wall on the part`);
    const { res: res2 } = portal();
    const b = fins.buildFins(topo, res2, rot, { mode, bedPad: true, plateOnly: true });
    assert(!b.props.some((q) => q.partAttached), `${mode}: a wall still stands on the part`);
    assert(b.skipped.onPart > 0, `${mode}: the dropped wall isn't counted`);
    // every support that IS built reaches down to the plate
    for (const f of b.fins) {
      let low = Infinity;
      for (const [i, j] of f.triRanges) for (let k = i; k < j; k++) low = Math.min(low, b.triangles[k][2]);
      assert(low < 0.5, `${mode}: a ${f.kind} bottoms out at z ${low.toFixed(2)}, off the plate`);
    }
    // Full refuses lines over the part before building them, not one wall at a time
    // until it hits its try limit (and then blames the limit)
    if (mode === 'full') assert(!b.fill.capped, `full: capped after ${b.fill.tries} tries`);
  });
}

Deno.test('plate only: off by default, and a part with nothing over it is unchanged', () => {
  const topo = loadModel('lbracket'), rot = rotY(35);
  const a = fins.buildFins(topo, analyze(topo, 45, rot), rot, { mode: 'auto', bedPad: true });
  const b = fins.buildFins(topo, analyze(topo, 45, rot), rot, { mode: 'auto', bedPad: true, plateOnly: true });
  assert(a.skipped.onPart === 0, 'onPart counted with Plate only off');
  assert(a.triangles.length === b.triangles.length
    && a.triangles.every((p, i) => p.every((v, k) => v === b.triangles[i][k])), 'lbracket changed');
});
