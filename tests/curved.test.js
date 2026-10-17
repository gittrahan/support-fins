// Curved walls (issue #25): the "Curved walls" checkbox (web/prop/curved.js). With it
// ticked, downhill walls are tried under every region and a region whose downhill walls
// bend past CURVED.minBend always swaps to them; in Auto the fill pass then takes the
// overhang the curves left bare. Unticked, the build is untouched.
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

const rotX = (d) => {
  const c = Math.cos((d * Math.PI) / 180), s = Math.sin((d * Math.PI) / 180);
  return [1, 0, 0, 0, c, -s, 0, s, c];
};
const build = (topo, extra = {}, rot = IDENTITY) => {
  const res = analyze(topo, 45, rot);
  globalThis.__TINECAP = [];
  const b = fins.buildFins(topo, res, rot, { mode: 'auto', bedPad: true, tines: true, ...extra });
  const caps = globalThis.__TINECAP;
  globalThis.__TINECAP = undefined;
  let low = Infinity;
  for (const t of caps) if (t.z < low) low = t.z;
  return { b, low, held: heldArea(topo, res, rot, b) };
};
const same = (a, b) => a.triangles.length === b.triangles.length
  && a.triangles.every((t, i) => t.every((v, k) => v === b.triangles[i][k]));

Deno.test('curved: a straight line has no bend, a quarter arc a clear one, a wobbling start none', () => {
  const straight = Array.from({ length: 20 }, (_, i) => [i, 0.5 * i, 10 - i]);
  assert(lineBend(straight) < 1e-6, `straight line bends ${lineBend(straight)}`);
  const R = 20, arc = Array.from({ length: 32 }, (_, i) => {
    const a = (i / 31) * (Math.PI / 2);
    return [R * Math.cos(a), R * Math.sin(a), 10];
  });
  const b = lineBend(arc);
  // the trimmed spread reads a 90 deg arc short of 90, but far past minBend
  assert(b > 2 * CURVED.minBend && b < 95, `quarter arc read as ${b.toFixed(1)} deg`);
  assert(lineBend([[0, 0, 0], [1, 0, 0]]) === 0, 'a two-station line must read as straight');
  // a straight wall whose first station sits 1 mm off the line (the climb's start)
  const wobble = straight.map((p, i) => (i === 0 ? [p[0], p[1] + 1, p[2]] : p));
  assert(lineBend(wobble) < CURVED.minBend, `a wobbling start read as a ${lineBend(wobble).toFixed(1)} deg bend`);
  // stations needn't be 1 mm apart: the same arc at half the stations reads the same
  const sparse = arc.filter((_, i) => i % 2 === 0);
  assert(Math.abs(lineBend(sparse) - b) < 10, `sparse arc ${lineBend(sparse).toFixed(1)} vs ${b.toFixed(1)}`);
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

Deno.test('curved: forced -- a curve that holds less still shows, and Auto fills what it left bare', () => {
  // The torus tilted X30: its one bending downhill wall held less than the straight
  // walls, so a hold-as-much race never picked it. Forced, it wins; the fill pass
  // then walls the overhang it missed, so the part ends up held at least as well.
  const topo = example('torus_flat');
  const off = build(topo, {}, rotX(30)), on = build(topo, { curvedWalls: true }, rotX(30));
  const bent = (b) => b.props.filter((q) => q.downhill && lineBend(q.line) > CURVED.minBend);
  assert(!bent(off.b).length, 'unticked, a bending wall won anyway');
  assert(bent(on.b).length >= 1, 'ticked, the curve did not show');
  assert(on.b.curvedFill?.walls >= 1, `ticked, the fill added ${on.b.curvedFill?.walls} walls`);
  assert(on.b.fill === undefined, 'Auto reported a Full coverage fill');
  assert(on.held >= off.held - 1e-6, `held ${off.held.toFixed(1)} -> ${on.held.toFixed(1)} mm2`);
  assert(on.low <= off.low + 0.1, `lowest tine rose ${off.low} -> ${on.low}`);
});

Deno.test('curved: in Full coverage the curves stay only within CURVED.fullSlack of the straight build', () => {
  // The spiral's arcs hold 0.8% less than Full's rows there: kept. The torus X30's
  // curve grips higher than the straight build: dropped, and the build says so.
  const full = { mode: 'full' };
  const spiral = example('issue25_spiral');
  const sOff = build(spiral, full), sOn = build(spiral, { ...full, curvedWalls: true });
  const bent = (b) => b.props.filter((q) => q.downhill && lineBend(q.line) > CURVED.minBend);
  assert(bent(sOn.b).length >= 2 && !sOn.b.curvedDropped, 'spiral: Full dropped curves within the slack');
  assert(sOn.held >= (1 - CURVED.fullSlack) * sOff.held - 1e-6, `spiral: held ${sOff.held.toFixed(1)} -> ${sOn.held.toFixed(1)} mm2`);
  const torus = example('torus_flat');
  const tOff = build(torus, full, rotX(30)), tOn = build(torus, { ...full, curvedWalls: true }, rotX(30));
  assert(tOn.b.curvedDropped && !bent(tOn.b).length, 'torus X30: Full kept a curve that grips higher');
  assert(Math.abs(tOn.held - tOff.held) < 1e-6, `torus X30: dropped build held ${tOn.held} vs ${tOff.held}`);
});
