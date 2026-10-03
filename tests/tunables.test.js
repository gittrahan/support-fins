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
  const before = { padH: fins.FIN.padH, grab: fins.PAD.grab, propGap: prop.PROP.gap };
  try {
    fins.applyTunables({ padH: 0.3, padGrab: -0.1, propGap: 0.3 });
    assert(fins.FIN.padH === 0.3, 'pad thickness not applied');
    assert(fins.PAD.grab === -0.1, 'pad grip not applied');
    assert(prop.PROP.gap === 0.3, 'prop gap not applied');
  } finally {
    fins.applyTunables({ padH: before.padH, padGrab: before.grab, propGap: before.propGap });
  }
});

Deno.test('tunables: absent or junk values leave the defaults alone', () => {
  const snap = () => [fins.FIN.padH, fins.PAD.grab, prop.PROP.gap];
  const before = snap();
  fins.applyTunables(undefined);
  fins.applyTunables({});
  fins.applyTunables({ padH: NaN, propGap: 'wide', padGrab: null });
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
