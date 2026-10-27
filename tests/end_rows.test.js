// Flush end rows are a candidate the judge races per region (web/prop/endrows.js, local
// issue 062 step 3): the flush layout stays only where it holds more overhang per mm3 of
// added plastic. `endRows: false` builds the flush layout everywhere, as before the race.
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

Deno.test('end rows: a layout the judge sees no gain in keeps its mid-strip rows (tshape X60, sparse)', () => {
  const race = build('tshape', 60, { coverage: 0 });
  const flush = build('tshape', 60, { coverage: 0, endRows: false });
  assert(race.props.length === 2 && flush.props.length === 3,
    `race ${race.props.length} walls, flush everywhere ${flush.props.length}; pinned 2 and 3`);
  assert(!race.props.some((q) => q.flush), 'no wall comes from the flush candidate');
});

Deno.test('end rows: a portal keeps the wedge the flush layout leaves it (the rows would serve its patch)', () => {
  const b = build('portal', 40);
  assert(b.fins.some((f) => f.kind === 'wedge'), 'the wedge is gone');
});
