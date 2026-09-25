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
  const tight = topAt({ propGap: 0.2, finGap: 0.2 });
  const loose = topAt({ propGap: 0.45, finGap: 0.45 });
  // Same part, same pose: the only thing that moved is the clearance, so the wall
  // top must drop by about the extra gap. Before the fix a Worker build ignored
  // both of these and the two came out identical.
  assert(loose < tight, `gap 0.45 built no lower than gap 0.2 (${loose} vs ${tight})`);
  assert(Math.abs((tight - loose) - 0.25) < 0.1,
         `top moved ${(tight - loose).toFixed(3)}mm for a 0.25mm gap change`);
});

Deno.test('tunables: the PETG profile reaches the build as PETG numbers', () => {
  const before = { finGap: fins.FIN.gap, bite: fins.FIN.tineBite, padH: fins.FIN.padH,
                   grab: fins.PAD.grab, propGap: prop.PROP.gap };
  try {
    fins.applyTunables({ finGap: 0.3, tineBite: 0.15, padH: 0.3, padGrab: -0.1, propGap: 0.3 });
    assert(fins.FIN.gap === 0.3, 'fin gap not applied');
    assert(fins.FIN.tineBite === 0.15, 'tine bite not applied');
    assert(fins.FIN.padH === 0.3, 'pad thickness not applied');
    assert(fins.PAD.grab === -0.1, 'pad grip not applied');
    assert(prop.PROP.gap === 0.3, 'prop gap not applied');
  } finally {
    fins.applyTunables({ finGap: before.finGap, tineBite: before.bite, padH: before.padH,
                         padGrab: before.grab, propGap: before.propGap });
  }
});

Deno.test('tunables: absent or junk values leave the defaults alone', () => {
  const snap = () => [fins.FIN.gap, fins.FIN.tineBite, fins.FIN.padH, fins.PAD.grab, prop.PROP.gap];
  const before = snap();
  fins.applyTunables(undefined);
  fins.applyTunables({});
  fins.applyTunables({ finGap: NaN, propGap: 'wide', padGrab: null });
  assert(snap().every((v, i) => v === before[i]),
         `defaults changed: ${snap().join(',')} vs ${before.join(',')}`);
});
