// The Onshape FeatureScript is a hand port: it copies engine numbers by hand and
// nothing else ties it to the engine, so it drifts (its tines ran 0.5 mm into the part
// long after the site's stopped at the surface). This reads each copied constant out of
// supportFins.fs and compares it with the engine's value today. Its side-fin numbers
// (FIN_*) come from the old web/fins.js, which the engine no longer has, so they have
// nothing to compare with.

import { assert } from './_util.js';
import { PROP } from '../web/prop/config.js';
import { SWAY } from '../web/sway.js';

const FS = new URL('../plugins/onshape/supportFins.fs', import.meta.url);

// `const NAME = 1.23 * millimeter;` / `const NAME = 3;` and `"key" : 0.5 * millimeter,`
function fsConsts(src) {
  const out = {};
  for (const m of src.matchAll(/^const\s+([A-Z_]+)\s*=\s*(-?[\d.]+)(?:\s*\*\s*millimeter)?\s*;/gm)) out[m[1]] = Number(m[2]);
  for (const m of src.matchAll(/^\s*"(\w+)"\s*:\s*(-?[\d.]+)\s*\*\s*millimeter\s*,/gm)) out[`cfg.${m[1]}`] = Number(m[2]);
  return out;
}

const eq = (c, name, want) => {
  assert(c[name] !== undefined, `${name}: not found in the port (renamed or removed?)`);
  assert(Math.abs(c[name] - want) < 1e-9, `${name}: port has ${c[name]}, engine has ${want}`);
};

Deno.test('Onshape port: copied constants match the engine', async () => {
  const c = fsConsts(await Deno.readTextFile(FS));
  eq(c, 'PROP_TH', PROP.th);
  eq(c, 'PROP_TIP', PROP.tip);
  eq(c, 'PROP_TIP_H', PROP.tipH);
  eq(c, 'PROP_FOOT_MIN', PROP.footMin);
  eq(c, 'PROP_FOOT_MAX', PROP.footMax);
  eq(c, 'PROP_FOOT_RATIO', PROP.footRatio);
  eq(c, 'PROP_MIN_SPAN', PROP.minSpan);
  eq(c, 'PROP_MIN_SPAN_SQ', PROP.minSpanSquat);
  eq(c, 'PROP_MIN_H', PROP.minHeight);
  eq(c, 'PROP_MIN_H_SQ', PROP.minHeightSquat);
  eq(c, 'SQUAT_BRIM_W', PROP.squatBrimW);
  eq(c, 'STATION_STEP', PROP.stationStep);
  eq(c, 'MIN_STATIONS', PROP.minStations);
  eq(c, 'CONTOUR_SLOPE_MIN', PROP.contourSlopeMin);
  eq(c, 'TINE_W', PROP.tineW);
  eq(c, 'TINE_OVERLAP', PROP.tineOverlap);
  eq(c, 'TINE_EDGE_BAND', PROP.tineEdgeBand);
  eq(c, 'TINE_MID_FACTOR', PROP.tineMidFactor);
  eq(c, 'TINE_STEP_SPARSE', PROP.tineStepSparse);
  eq(c, 'TINE_TOP_CLEAR', PROP.tineTopClear);
  eq(c, 'TINE_SLOPE_MIN', PROP.tineSlopeMin);
  eq(c, 'MIN_GRIP_TINES', PROP.minGripTines);
  eq(c, 'cfg.baseH', PROP.baseH);
  // kiss tines: a tine ends at the part's surface, overlapping it by the contact offset
  eq(c, 'TINE_CONTACT', -PROP.tineContactOffset);
  eq(c, 'cfg.propReach', PROP.tineReach);
  eq(c, 'cfg.finReach', SWAY.tineReach);
  assert(!('cfg.propBite' in c) && !('cfg.finBite' in c),
    'a tine bite is back: the site\'s tines stop at the part\'s surface (web/kiss.js)');
});
