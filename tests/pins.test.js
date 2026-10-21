// Resin pins (GitHub #309, web/prop/pins.js): the 'vertical' tine direction. A flat
// span -- the reporter's case, where the horizontal comb finds nothing to grip --
// gets pins up into its underside; every pin bites the part and none comes out the
// far side; and the default (horizontal) build is untouched by the new switch.

import { loadModel, analyze, fins, prop, insidePart, isClosed, isOriented, assert } from './_util.js';

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function build(name, tunables) {
  const topo = loadModel(name), res = analyze(topo, 45, IDENTITY);
  try {
    globalThis.__TINECAP = [];
    const b = fins.buildFins(topo, res, IDENTITY, { mode: 'auto', bedPad: true, tines: true, tunables });
    return { topo, res, b, caps: globalThis.__TINECAP };
  } finally {
    delete globalThis.__TINECAP;
    fins.applyTunables({ tineDir: 'horizontal', pinDepth: 0.1 });   // module state back to the default
  }
}

Deno.test('pins: a flat span the comb can\'t grip gets pins (lowledge)', () => {
  const flat = build('lowledge', { tineDir: 'horizontal' });
  const pins = build('lowledge', { tineDir: 'vertical' });
  assert(flat.b.tines === 0, `the comb gripped a flat ceiling (${flat.b.tines}): the test lost its point`);
  assert(pins.b.tines >= 3, `only ${pins.b.tines} pins under the ledge`);
});

Deno.test('pins: every pin sinks pinDepth into the part, none pokes out the top', () => {
  for (const depth of [0.1, 0.3, 1.0]) {
    const { topo, res, caps } = build('lowledge', { tineDir: 'vertical', pinDepth: depth });
    for (const { x, y, z } of caps) {
      // z is a half layer under the underside; the pin's top is depth into the part
      let under = z;
      while (!insidePart(topo, IDENTITY, res.offset, x, y, under)) under += 0.02;
      assert(insidePart(topo, IDENTITY, res.offset, x, y, under + depth - 0.03),
        `a pin at ${x.toFixed(1)},${y.toFixed(1)} would come out the part at depth ${depth}`);
    }
  }
});

Deno.test('pins: the pinned build is closed and oriented (each pin a box)', () => {
  const { b } = build('lowledge', { tineDir: 'vertical' });
  assert(isClosed(b.triangles), 'pins left the support mesh open');
  assert(isOriented(b.triangles), 'pins left the support mesh wound inconsistently');
});

Deno.test('pins: horizontal is the default, and the switch back restores it exactly', () => {
  const plain = build('lowledge', undefined).b.triangles;
  build('lowledge', { tineDir: 'vertical' });
  const back = build('lowledge', { tineDir: 'horizontal' }).b.triangles;
  const flat = (tris) => tris.flat(2);
  const a = flat(plain), c = flat(back);
  assert(a.length === c.length && a.every((v, i) => v === c[i]),
    'a vertical build left the next horizontal one different');
});

Deno.test('pins: a wall on the part welds its foot under vertical (no floating island)', () => {
  fins.applyTunables({ tineDir: 'vertical' });
  try { assert(prop.PROP.footGap === 0, 'vertical kept the FDM foot gap'); }
  finally { fins.applyTunables({ tineDir: 'horizontal' }); }
  assert(prop.PROP.footGap > 0, 'horizontal lost the foot gap');
});

Deno.test('pins: each pin narrows to its contact tip where it meets the part', () => {
  // sample every face of each pin: nothing wider than the tip is inside the part --
  // on lowledge's flat ceiling and the sphere's curved underside alike
  for (const name of ['lowledge', 'sphere']) {
    const { topo, res, b, caps } = build(name, { tineDir: 'vertical' });
    const tipR = prop.PROP.pinTipW / 2 * Math.SQRT2 + 0.01, T = b.triangles;   // flat [x, y, z] vertices
    assert(caps.length >= 3, `only ${caps.length} pins on ${name}`);
    for (const { x, y } of caps) {
      let widens = false;
      for (let i = 0; i < T.length; i += 3) {
        const tri = [T[i], T[i + 1], T[i + 2]];
        if (!tri.every((v) => Math.hypot(v[0] - x, v[1] - y) < 0.3)) continue;   // the pin's own faces
        if (tri.some((v) => Math.hypot(v[0] - x, v[1] - y) > tipR)) widens = true;
        for (let a = 0; a <= 8; a++) for (let c = 0; a + c <= 8; c++) {
          const w = [a / 8, c / 8, 1 - (a + c) / 8];
          const q = [0, 1, 2].map((k) => w[0] * tri[0][k] + w[1] * tri[1][k] + w[2] * tri[2][k]);
          assert(!(Math.hypot(q[0] - x, q[1] - y) > tipR && insidePart(topo, IDENTITY, res.offset, ...q)),
            `a pin at ${x.toFixed(1)},${y.toFixed(1)} on ${name} meets the part wider than its tip`);
        }
      }
      assert(widens, `a pin at ${x.toFixed(1)},${y.toFixed(1)} on ${name} never widens below the tip`);
    }
  }
});
