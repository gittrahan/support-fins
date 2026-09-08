// Tine grip on REAL parts through the WHOLE pipeline.
//
// The synthetic-block tine tests pin emitTines in isolation, but the bug that kept
// shipping only shows when the real support walls are placed by buildProps/buildPerpFins
// on a real overhang and THEN tined -- and only when analyze() is called the way the
// browser calls it: analyze(topo, 45, rot). (A harness that dropped the threshold arg
// silently ran with identity rotation and measured nothing real.) So this runs the
// exact site pipeline on committed models across several poses, captures every tine the
// engine emits (via globalThis.__TINECAP, the seam emitTines writes to), and checks each
// one from scratch:
//   - it GRIPS: the nub tip lands inside the part, not in air;
//   - it is NOT FLAT: its bite is aligned with the nearest face's inward horizontal
//     normal (biting straight into the face), not lying tangent along it.
// nearestFaceInwardH is computed independently here, so this does not just re-assert the
// engine's own biteDirAt.

import { loadModel, analyze, fins, prop, insidePart, nearestFaceInwardH, rotX, rotY, assert } from './_util.js';

const TINE_BITE = prop.PROP.tineBite;   // how far the nub reaches in -- read from source, don't drift

const CASES = [
  ['plate', rotX(45)], ['plate', rotY(40)], ['plate', rotY(-40)],
  ['ramp', rotX(35)], ['wedge', rotX(45)], ['wedge', rotY(40)],
  ['lbracket', rotY(-40)], ['lbracket', rotX(40)],
  ['arch', rotX(30)], ['tshape', rotX(40)], ['ushape', rotX(45)], ['bar', rotX(45)],
];

Deno.test('tines on real parts: every tine bites INTO the nearest face, none lie flat or grip air', () => {
  let total = 0, noGrip = 0, flat = 0, checked = 0;
  const flatCases = new Set(), airCases = new Set(), sparseCases = [];
  for (const [name, rot] of CASES) {
    const topo = loadModel(name);
    const res = analyze(topo, 45, rot);
    globalThis.__TINECAP = [];
    fins.buildFins(topo, res, rot, { mode: 'auto', bedPad: true });
    const caps = globalThis.__TINECAP;
    for (const c of caps) {
      total++;
      const bx = c.x + c.biteX * TINE_BITE, by = c.y + c.biteY * TINE_BITE;
      if (!insidePart(topo, rot, res.offset, bx, by, c.z)) { noGrip++; airCases.add(name); }
      const inw = nearestFaceInwardH(topo, rot, res.offset, [c.x, c.y, c.z]);
      if (inw) {
        checked++;
        const align = c.biteX * inw.x + c.biteY * inw.y;   // 1 = straight into the face, 0 = flat
        if (align < 0.85) { flat++; flatCases.add(`${name}(${align.toFixed(2)})`); }
      }
    }
    // DENSITY: a grippable wall must get a DENSE comb, not the sparse ~9mm comb a
    // tip-over-risk scale once handed "stable" parts -- which read as a few nubs
    // laying on the face. The comb is EDGE-BIASED (dense at each wall's ends, thinned
    // across the middle), so the whole-part median legitimately rises with the
    // middle; what proves grip is the DENSE END ANCHORS. So check the densest quarter
    // (p25 nearest-neighbour): a real comb keeps it near tineStep (a hair over 2mm
    // once a tilt projects the arc-length step), a scattered no-grip comb pushes even
    // this wide.
    if (caps.length >= 6) {
      const nn = caps.map((a, i) => {
        let best = Infinity;
        caps.forEach((b, j) => { if (i !== j) best = Math.min(best, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)); });
        return best;
      }).sort((p, q) => p - q);
      const p25 = nn[Math.floor(0.25 * nn.length)];
      if (p25 > 3.5) sparseCases.push(`${name}(p25 ${p25.toFixed(1)}mm)`);
    }
  }
  globalThis.__TINECAP = undefined;
  assert(total >= 20, `too few tines across real parts to be a meaningful check: ${total}`);
  assert(noGrip === 0, `${noGrip}/${total} tines bite AIR (tip not inside the part): ${[...airCases]}`);
  assert(flat === 0, `${flat}/${checked} tines lie FLAT (bite off the face inward normal): ${[...flatCases]}`);
  assert(sparseCases.length === 0, `SPARSE comb (nubs laying on the face, not gripping) -- median tine spacing too wide: ${sparseCases}`);
});
