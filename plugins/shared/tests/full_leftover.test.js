// Full coverage's red its fill walls leave bare reaches every host (#497). The site's
// readout says it; the plugins got no field for it, so a torus flat on the plate read
// "40 walls, 121 tines" with 573 of 1618 mm2 still bare, and Orca flagged nothing.

import { computeFins } from '../engine/fins_entry.js';
import { reportLine } from '../engine/report.js';
import { readSTL, MODELS, assert } from '../../../tests/_util.js';

const OPTS = { mode: 'full', bedPad: true, tines: true, layerHeight: 0.2 };
const stl = (name) => Float64Array.from(readSTL(Deno.readFileSync(`${MODELS}${name}.stl`)));

Deno.test('full leftover: the torus at its wall cap says so, with the bare area', () => {
  const { stats } = computeFins(stl('torus'), OPTS);
  assert(stats.fullCapped === true, `the fill didn't stop at its cap: ${JSON.stringify(stats)}`);
  assert(Number.isInteger(stats.fullBare) && stats.fullBare > 100, `fullBare ${stats.fullBare}`);
  const line = reportLine(stats);
  assert(line.includes(`Full coverage stopped at its wall limit with ${stats.fullBare} mm² of overhang still bare`), line);
});

Deno.test('full leftover: Auto reports none, and a part Full covers says nothing more', () => {
  const auto = computeFins(stl('torus'), { ...OPTS, mode: 'auto' }).stats;
  assert(auto.fullBare === 0 && auto.fullCapped === false, `Auto carried Full's fields: ${auto.fullBare} ${auto.fullCapped}`);
  const cube = computeFins(stl('cube'), OPTS).stats;
  assert(cube.fullBare === 0 && !cube.fullCapped && !/mm² of overhang/.test(reportLine(cube)), reportLine(cube));
});
