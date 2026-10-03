// The clearance settings reaching the BUILD, wherever it runs.
//
// ui/settings.js sets FIN / PROP / PAD directly for the PLA/PETG profiles and the Support gap
// and Pad grip fields, but the build runs in a module Worker with its own copy of those
// modules, so none of it arrived: Auto mode always built PLA's numbers while the panel
// said PETG. They now travel with the request as `opts.tunables` and are applied by
// `buildFins` in whichever instance is building.

import { tiltedBlockTopo, analyze, fins, prop, bbox, assert } from './_util.js';

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Highest point of the support built for a tilted block at this gap. */
function topAt(tunables) {
  const topo = tiltedBlockTopo(-20, 20, -15, 15, 0, 30, 45);
  const res = analyze(topo, 45, IDENTITY);
  const built = fins.buildFins(topo, res, IDENTITY,
    { mode: 'auto', bedPad: true, tines: true, tunables });
  assert(built.triangles.length > 0, 'no support built to measure');
  return bbox(built.triangles).hi[2];
}

Deno.test('tunables: a bigger support gap stops the support lower under the part', () => {
  const tight = topAt({ propGap: 0.2 });
  const loose = topAt({ propGap: 0.45 });
  // Same part, same pose: the only thing that moved is the clearance, so the wall
  // top must drop by about the extra gap. Before the fix a Worker build ignored
  // both of these and the two came out identical.
  assert(loose < tight, `gap 0.45 built no lower than gap 0.2 (${loose} vs ${tight})`);
  assert(Math.abs((tight - loose) - 0.25) < 0.1,
         `top moved ${(tight - loose).toFixed(3)}mm for a 0.25mm gap change`);
});

Deno.test('tunables: the PETG profile reaches the build as PETG numbers', () => {
  const before = { bite: fins.FIN.tineBite, padH: fins.FIN.padH,
                   grab: fins.PAD.grab, propGap: prop.PROP.gap };
  try {
    fins.applyTunables({ tineBite: 0.15, padH: 0.3, padGrab: -0.1, propGap: 0.3 });
    assert(fins.FIN.tineBite === 0.15, 'tine bite not applied');
    assert(fins.FIN.padH === 0.3, 'pad thickness not applied');
    assert(fins.PAD.grab === -0.1, 'pad grip not applied');
    assert(prop.PROP.gap === 0.3, 'prop gap not applied');
  } finally {
    fins.applyTunables({ tineBite: before.bite, padH: before.padH,
                         padGrab: before.grab, propGap: before.propGap });
  }
});

Deno.test('tunables: absent or junk values leave the defaults alone', () => {
  const snap = () => [fins.FIN.tineBite, fins.FIN.padH, fins.PAD.grab, prop.PROP.gap];
  const before = snap();
  fins.applyTunables(undefined);
  fins.applyTunables({});
  fins.applyTunables({ tineBite: NaN, propGap: 'wide', padGrab: null });
  assert(snap().every((v, i) => v === before[i]),
         `defaults changed: ${snap().join(',')} vs ${before.join(',')}`);
});

Deno.test('tunables: a bigger gap keeps the walls under a 40 deg underside (021)', () => {
  // The weld gate measures the NEAREST distance, ~gap x cos(slope) on a slope. As
  // `gap - 0.065` it passed PLA's 0.2 there but failed PETG's 0.3 (0.230 < 0.235):
  // every wall counted as a weld and the face went to a lone wedge, unserved.
  const topo = tiltedBlockTopo(-20, 20, -15, 15, 0, 30, 40);
  const res = analyze(topo, 45, IDENTITY);
  const build = (propGap) => {
    const b = fins.buildFins(topo, res, IDENTITY,
      { mode: 'auto', bedPad: true, tines: true, tunables: { propGap } });
    return { walls: b.props.filter((p) => p.kind === 'prop').length, unserved: b.unserved };
  };
  const gap0 = prop.PROP.gap;
  let pla, petg;
  try { pla = build(0.2); petg = build(0.3); } finally { fins.applyTunables({ propGap: gap0 }); }
  assert(pla.walls > 0, 'PLA built no walls to compare against');
  // walls + unserved catch it: main lost them in stationCertified's trim, not skipped.weld
  assert(petg.walls === pla.walls && petg.unserved === 0,
         `gap 0.3: ${JSON.stringify(petg)} where gap 0.2 built ${JSON.stringify(pla)}`);
});

Deno.test('tunables: the weld floor scales with the gap, PLA unchanged', () => {
  const gap0 = prop.PROP.gap;
  try {
    const at40 = (gap) => ({ d: gap * Math.cos(40 * Math.PI / 180), cosUp: 0.77 });
    for (const gap of [0.2, 0.3, 0.45]) {
      fins.applyTunables({ propGap: gap });
      assert(!prop.welds(at40(gap)), `gap ${gap}: an on-spec 40 deg approach counted as a weld`);
      assert(prop.welds({ d: gap * 0.5, cosUp: 0.9 }), `gap ${gap}: half the gap passed`);
      assert(prop.welds({ d: 0.2, cosUp: 0 }), `gap ${gap}: a 0.2 mm flank passed`);
    }
    fins.applyTunables({ propGap: 0.2 });
    assert(Math.abs(0.2 * 0.675 - (0.2 - 0.065)) < 1e-12, 'PLA floor moved off 0.135');
  } finally {
    fins.applyTunables({ propGap: gap0 });
  }
});

Deno.test('tunables: tine width and a pointed tip shrink the tines, same count', () => {
  // The tine coupon's knobs (calibration/tine). Same part, same pose: the tip never
  // moves the comb (placement is by tineBite), and on this part neither does the
  // width (it sets the anchor scan's step, which can shift where the comb starts).
  const topo = tiltedBlockTopo(-20, 20, -15, 15, 0, 30, 40);
  const res = analyze(topo, 45, IDENTITY);
  // signed volume of the closed boxes the soup is made of (overlaps counted twice,
  // the same in every build, so differences are the tines')
  const vol = (t) => {
    let v = 0;
    for (let i = 0; i < t.length; i += 3) {
      const [a, b, c] = [t[i], t[i + 1], t[i + 2]];
      v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0])
          + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    }
    return v;
  };
  const build = (tunables) => {
    const b = fins.buildFins(topo, res, IDENTITY, { mode: 'auto', bedPad: false, tines: true, tunables });
    return { tines: b.tines, v: vol(b.triangles) };
  };
  const w0 = prop.PROP.tineW, tip0 = prop.PROP.tineTip;
  let base, narrow, point;
  try {
    base = build({});
    narrow = build({ tineWidth: 0.3 });
    point = build({ tineWidth: w0, tineTip: 'point' });
  } finally { fins.applyTunables({ tineWidth: w0, tineTip: tip0 }); }
  assert(base.tines > 0, 'no tines to compare');
  assert(narrow.tines === base.tines && point.tines === base.tines,
         `tine count moved: ${base.tines} / ${narrow.tines} / ${point.tines}`);
  // tines kiss the part (kissEnds), so each one's length follows the surface: the
  // savings vary by tine, but narrower or pointed is always less plastic
  assert(narrow.v < base.v - 1e-4, `0.3 wide saved nothing (${base.v.toFixed(4)} -> ${narrow.v.toFixed(4)})`);
  assert(point.v < base.v - 1e-4, `point saved nothing (${base.v.toFixed(4)} -> ${point.v.toFixed(4)})`);
  assert(prop.PROP.tineW === 0.5 && prop.PROP.tineTip === 'square', 'defaults not restored');
});

Deno.test('tunables: tinesPerWall puts exactly n tines on every tined wall', () => {
  // The tine coupon's how-few-still-hold row. 0 (the default) leaves spacing alone.
  const topo = tiltedBlockTopo(-20, 20, -15, 15, 0, 30, 40);
  const res = analyze(topo, 45, IDENTITY);
  const perWall = (tunables) => fins.buildFins(topo, res, IDENTITY,
    { mode: 'auto', bedPad: false, tines: true, tunables }).props
    .filter((f) => f.tines > 0).map((f) => f.tines);
  const n0 = prop.PROP.tinesPerWall;
  let base, one, two;
  try {
    base = perWall({});
    one = perWall({ tinesPerWall: 1 });
    two = perWall({ tinesPerWall: 2 });
  } finally { fins.applyTunables({ tinesPerWall: n0 }); }
  assert(base.length > 0 && base.some((n) => n > 2), `nothing to thin: ${base}`);
  assert(one.length && one.every((n) => n === 1), `tinesPerWall 1 gave ${one}`);
  assert(two.length && two.every((n) => n === 2), `tinesPerWall 2 gave ${two}`);
  assert(prop.PROP.tinesPerWall === 0, 'default not restored');
});
