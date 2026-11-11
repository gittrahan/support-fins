// Hand-ported plugins copy engine numbers by hand and have no other test tying them
// to the engine, so they drift: the PrusaSlicer port kept running tines 0.5 mm into
// the part long after the site's tines stopped at the surface. This reads each copied
// constant out of the port's source and compares it with the engine's value today.
//
// A difference the port keeps on purpose is listed with BOTH values, so a change on
// either side still fails here and someone decides again.

import { assert } from './_util.js';
import { PROP } from '../web/prop/config.js';

const PRUSA = new URL('../plugins/prusa/com.printfins.support-fins/add_fin.lua', import.meta.url);

// `local NAME = 1.23` at the top of a Lua file
function luaConsts(src) {
  const out = {};
  for (const m of src.matchAll(/^local\s+([A-Z_]+)\s*=\s*(-?[\d.]+)\b/gm)) out[m[1]] = Number(m[2]);
  return out;
}

const eq = (name, got, want) => {
  assert(got !== undefined, `${name}: not found in the port (renamed or removed?)`);
  assert(Math.abs(got - want) < 1e-9, `${name}: port has ${got}, engine has ${want}`);
};

Deno.test('Prusa port: copied constants match the engine', async () => {
  const c = luaConsts(await Deno.readTextFile(PRUSA));
  eq('GAP (PROP.gap)', c.GAP, PROP.gap);
  eq('BASE_H (PROP.baseH)', c.BASE_H, PROP.baseH);
  eq('TINE_W (PROP.tineW)', c.TINE_W, PROP.tineW);
  eq('MIN_TINES (PROP.minGripTines)', c.MIN_TINES, PROP.minGripTines);
  eq('TOP_CLEAR (PROP.tineTopClear)', c.TOP_CLEAR, PROP.tineTopClear);
  // kiss tines: the end stops at the surface, overlapping it by the contact offset
  eq('CONTACT (-PROP.tineContactOffset)', c.CONTACT, -PROP.tineContactOffset);
  assert(!('BITE' in c), 'BITE is back: the site\'s tines stop at the part\'s surface (web/kiss.js)');
});

Deno.test('Prusa port: kept differences are still the ones written down', async () => {
  const c = luaConsts(await Deno.readTextFile(PRUSA));
  // A tilted-print fin stands alone and grips through a rail, not a wall: thicker,
  // and its tines sink deeper into it. The default spacing is the sparse printed one.
  eq('FIN_TH (port 1.2)', c.FIN_TH, 1.2);
  eq('PROP.th (engine 1.0)', PROP.th, 1.0);
  eq('TINE_GRIP (port 0.4)', c.TINE_GRIP, 0.4);
  eq('PROP.tineOverlap (engine 0.3)', PROP.tineOverlap, 0.3);
});
