// Curved walls (issue #25): the "Curved walls" checkbox (web/prop/curved.js). With it
// ticked, a region whose downhill walls bend past CURVED.minBend swaps to them when
// they hold at least as much, at any weight; unticked, the build is untouched.
import { fileURLToPath } from 'node:url';
import { buildTopology, analyze, fins, assert, readSTL } from './_util.js';
import { CURVED, lineBend } from '../web/prop/curved.js';
import { heldArea } from '../web/fins/downhill.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const example = (name) => {
  const pos = readSTL(Deno.readFileSync(`${FIXTURES}${name}.stl`));
  return buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
};

const build = (topo, extra = {}) => {
  const res = analyze(topo, 45, IDENTITY);
  globalThis.__TINECAP = [];
  const b = fins.buildFins(topo, res, IDENTITY, { mode: 'auto', bedPad: true, tines: true, ...extra });
  const caps = globalThis.__TINECAP;
  globalThis.__TINECAP = undefined;
  let low = Infinity;
  for (const t of caps) if (t.z < low) low = t.z;
  return { b, low, held: heldArea(topo, res, IDENTITY, b) };
};
const same = (a, b) => a.triangles.length === b.triangles.length
  && a.triangles.every((t, i) => t.every((v, k) => v === b.triangles[i][k]));

Deno.test('curved: a straight line has no bend, a quarter arc about 90 deg', () => {
  const straight = Array.from({ length: 20 }, (_, i) => [i, 0.5 * i, 10 - i]);
  assert(lineBend(straight) < 1e-6, `straight line bends ${lineBend(straight)}`);
  const R = 20, arc = Array.from({ length: 32 }, (_, i) => {
    const a = (i / 31) * (Math.PI / 2);
    return [R * Math.cos(a), R * Math.sin(a), 10];
  });
  const b = lineBend(arc);
  assert(b > 80 && b < 95, `quarter arc read as ${b.toFixed(1)} deg`);
  assert(lineBend([[0, 0, 0], [1, 0, 0]]) === 0, 'a two-station line must read as straight');
});

Deno.test('curved: the spiral ramp gets walls that follow its curve, holding as much', () => {
  // A ramp that winds down to the plate: its downhill walls arc round in plan. Unticked,
  // the arcs weigh 1.5x the straight walls and lose the race, so none shows.
  const topo = example('issue25_spiral');
  const off = build(topo), on = build(topo, { curvedWalls: true });
  const bent = (b) => b.props.filter((q) => q.downhill && lineBend(q.line) > CURVED.minBend);
  assert(!bent(off.b).length, 'unticked, a bending wall won anyway');
  assert(bent(on.b).length >= 2, `ticked, ${bent(on.b).length} bending walls`);
  assert(on.held >= off.held - 1e-6, `held ${off.held.toFixed(1)} -> ${on.held.toFixed(1)} mm2`);
  assert(on.low <= off.low + 0.1, `lowest tine rose ${off.low} -> ${on.low}`);
});

Deno.test('curved: unticked is the build without the option; ticked changes nothing where no wall bends', () => {
  for (const name of ['issue25_spiral', 'issue25_curve']) {
    const topo = example(name);
    const base = build(topo).b;
    assert(same(base, build(topo, { curvedWalls: false }).b), `${name}: curvedWalls:false changed the build`);
  }
  // the #25 part's downhill walls run straight: nothing for the box to do
  const topo = example('issue25_curve');
  assert(same(build(topo).b, build(topo, { curvedWalls: true }).b), 'issue25_curve: ticked changed a straight-walled build');
});
