// Flush end rows are a candidate the judge races per region (web/prop/endrows.js, local
// issue 062 step 3): the flush layout stays unless the judge scores the mid-strip rows higher
// (a tie keeps flush). `endRows: false` builds the flush layout everywhere, as before the race.
import { analyze, fins, loadModel, rotX, assert } from './_util.js';

const build = (name, deg, extra = {}) => {
  const topo = loadModel(name), rot = rotX(deg), res = analyze(topo, 45, rot);
  return fins.buildFins(topo, res, rot, { mode: 'auto', bedPad: true, tines: true, coverage: 0.5, ...extra });
};

Deno.test('end rows: a tilted cube wins its flush ends in the race -- 4 walls, the end ones tagged flush', () => {
  const b = build('cube', 40);
  assert(b.props.length === 4, `${b.props.length} walls, pinned 4`);
  assert(b.props.filter((q) => q.flush).length === 4, 'the walls come from the flush candidate');
});

Deno.test('end rows: a tie on the judge keeps the flush layout (tshape X60, sparse)', () => {
  // the mid-strip rows hold exactly what the flush ends do there; the cheaper layout must not win
  const race = build('tshape', 60, { coverage: 0 });
  assert(race.props.some((q) => q.flush), 'the flush layout won the tie');
  // (the flush layout replaces the mid-strip rows: no row of the old layout stays beside it)
  assert(race.props.length === 3, `${race.props.length} walls, pinned 3`);
});

Deno.test('end rows: a portal keeps the wedge the flush layout leaves it (the rows would serve its patch)', () => {
  const b = build('portal', 40);
  assert(b.fins.some((f) => f.kind === 'wedge'), 'the wedge is gone');
});
