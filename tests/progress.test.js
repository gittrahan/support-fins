// Live Full coverage builds (web/fins/progress.js; ui/livebuild.js shows them). Pins
// that reporting changes nothing built, that what is posted is the first layout's
// walls in order, that Stop (stopOpts) rebuilds exactly the walls shown, and that the
// bar only moves forward and never claims done.

import { loadModel, analyze, fins, rotX, assert } from './_util.js';

const { liveProgress, stopOpts, flatTris } = await import('../web/fins/progress.js');

const OPTS = { bedPad: true, tines: true, tineDensity: 0, layerHeight: 0.2, mode: 'full' };

// The staircase at X40 (tests/fill.test.js's part): Auto leaves red the fill walls take.
const topo = loadModel('staircase');
const rot = rotX(40);
const res = analyze(topo, 45, rot);

const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

/** A Full build with a reporter on: the build and every message, in order. */
function liveBuild(opts) {
  const msgs = [];
  let clock = 0;
  const progress = liveProgress(opts, (m) => msgs.push(m), { now: () => (clock += 50) });
  const built = fins.buildFins(topo, res, rot, { ...opts, progress });
  return { built, msgs, shown: progress.shown };
}

const plain = fins.buildFins(topo, res, rot, OPTS);
const live = liveBuild(OPTS);
const walls = live.msgs.filter((m) => m.type === 'wall');

Deno.test('progress: a live build is byte-identical to one without the reporter', () => {
  assert(same(flatTris(plain.triangles), flatTris(live.built.triangles)), 'fin triangles changed');
  assert(same(flatTris(plain.padTriangles ?? []), flatTris(live.built.padTriangles ?? [])), 'pad changed');
  assert(plain.fins.length === live.built.fins.length, 'fin count changed');
});

Deno.test('progress: the first layout\'s Auto walls come first, then its fill walls one by one', () => {
  assert(live.msgs[0].type === 'tick' || live.msgs[0].type === 'auto', 'starts with Auto');
  const autos = live.msgs.filter((m) => m.type === 'auto');
  assert(autos.length === 1, `one Auto post, got ${autos.length}`);
  assert(walls.length > 0 && walls.length === live.shown, `walls posted ${walls.length}, shown ${live.shown}`);
  const firstWall = live.msgs.findIndex((m) => m.type === 'wall');
  assert(live.msgs.findIndex((m) => m.type === 'auto') < firstWall, 'a wall before Auto');
});

Deno.test('progress: Stop at k walls rebuilds exactly the first k walls shown', () => {
  const autoTris = live.msgs.find((m) => m.type === 'auto').tris;
  for (const k of new Set([0, 1, Math.min(2, walls.length), walls.length])) {
    const b = fins.buildFins(topo, res, rot, stopOpts(OPTS, k));
    const fill = b.fins.filter((f) => f.fill);
    assert(fill.length === k, `k=${k}: ${fill.length} fill walls`);
    // its Auto is the shown Auto, and its fill walls (their first range: the wall,
    // before braces and ties) are the shown walls, in order
    assert(same(flatTris(b.triangles.slice(0, autoTris.length / 9 * 3)), autoTris), `k=${k}: Auto differs`);
    fill.forEach((f, i) => {
      const [a, z] = f.triRanges[0];
      assert(same(flatTris(b.triangles.slice(a, z)), walls[i].tris), `k=${k}: wall ${i} differs`);
    });
    assert(k === walls.length || b.fill.stopped === true, `k=${k}: not marked stopped`);
    assert(!b.fill.capped, `k=${k}: a stop reads as the budget running out`);
  }
});

Deno.test('progress: the bar only moves forward and stays short of done', () => {
  const ticks = live.msgs.filter((m) => m.type === 'tick');
  assert(ticks.length > 1, 'no ticks');
  for (let i = 1; i < ticks.length; i++) assert(ticks[i].frac >= ticks[i - 1].frac, `bar went back at ${i}`);
  assert(ticks.every((m) => m.frac >= 0 && m.frac < 1), 'bar out of range');
  assert(ticks.some((m) => m.phase === 'fill'), 'never said it was filling');
});

Deno.test('progress: stopOpts keeps a request that names its downhill build or turns races off', () => {
  assert(stopOpts({ raster: false }, 3).downhill === false);
  assert(stopOpts({ downhill: false }, 3).downhill === false);
  assert(stopOpts({}, 3).downhill === true);
  const o = stopOpts({ longWalls: true, progress: {} }, 4);
  assert(o.longWalls === false && o.fillStopAt === 4 && o.progress === undefined);
});
