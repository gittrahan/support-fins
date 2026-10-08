// TIES (web/prop/ties.js, local issue 036): a zigzag of struts between two neighbouring
// walls, so a forest of thin fill walls stands as one frame. Every strut must print
// without support (55deg, each starting on the plate or the strut below), stop under
// the lower wall's limit, keep sideClear off the part, and be a closed outward solid.
import { assert, block } from './_util.js';
import { PROP, TIE, tieWalls } from '../web/prop.js';

const NONE = new Float32Array(0);
const vol = (out, from, to) => {
  let s = 0;
  for (let j = from; j < to; j += 3) {
    const [a, c, d] = [out[j], out[j + 1], out[j + 2]];
    s += a[0] * (c[1] * d[2] - c[2] * d[1]) - a[1] * (c[0] * d[2] - c[2] * d[0]) + a[2] * (c[0] * d[1] - c[1] * d[0]);
  }
  return s / 6;
};

Deno.test('ties: two walls 6 mm apart get a zigzag of 55deg struts, under the limit, each a closed outward solid', () => {
  const out = [];
  const n = tieWalls([0, 0], [6, 0], 30, NONE, 0, out);
  const climb = 6 * TIE.slope;
  assert(n === Math.floor((30 - TIE.thick) / climb), `struts ${n}`);
  const zs = out.map((v) => v[2]);
  assert(Math.min(...zs) >= -1e-9, 'nothing under the plate');
  assert(Math.max(...zs) <= 30 + 1e-9, `struts stop under the limit (top ${Math.max(...zs).toFixed(2)})`);
  // each strut: 12 triangles (a quad extruded), positive volume ~ its length x th x thick
  const per = 36;
  assert(out.length === n * per, `${out.length} vertices for ${n} struts`);
  for (let s = 0; s < n; s++) {
    const v = vol(out, s * per, (s + 1) * per);
    assert(v > 0, `strut ${s} wound inward (${v.toFixed(3)})`);
    const len = (6 + PROP.th) * PROP.th * TIE.thick;     // run x across x depth (a sheared box)
    assert(Math.abs(v - len) < 0.35 * len, `strut ${s} volume ${v.toFixed(2)} vs ~${len.toFixed(2)}`);
  }
  // every strut rises at TIE.slope: printable without support
  assert(TIE.slope >= 1, 'struts steeper than 45deg');
});

Deno.test('ties: too close, too far, or too low gets none', () => {
  const out = [];
  assert(tieWalls([0, 0], [TIE.minSpan - 0.1, 0], 30, NONE, 0, out) === 0, 'too close');
  assert(tieWalls([0, 0], [TIE.maxSpan + 0.1, 0], 30, NONE, 0, out) === 0, 'too far');
  assert(tieWalls([0, 0], [6, 0], 6 * TIE.slope, NONE, 0, out) === 0, 'no room for one strut');
  assert(out.length === 0, 'nothing written');
});

Deno.test('ties: a part between the walls keeps the tie out (sideClear, or inside it)', () => {
  // a post across the gap, 10 mm tall: the first strut runs through it
  const part = block(2.5, 3.5, -5, 5, 0, 10);
  const out = [];
  assert(tieWalls([0, 0], [6, 0], 30, part, 0, out) === 0 && out.length === 0, 'tie through a part');
  // a slab the first strut would sit inside (no surface within its band at the centre)
  const slab = block(-20, 20, -20, 20, 2, 9);
  assert(tieWalls([0, 0], [6, 0], 30, slab, 0, []) === 0, 'tie inside a part');
  // a block beside the tie, sideClear + 0.05 off its side: fine
  const off = PROP.th / 2 + PROP.sideClear + 0.05;
  const beside = block(0, 6, off, off + 3, 0, 20);
  assert(tieWalls([0, 0], [6, 0], 30, beside, 0, []) > 0, 'a part just clear of the tie refused it');
  // ...and inside sideClear: refused
  const near = block(0, 6, off - 0.1, off + 3, 0, 20);
  assert(tieWalls([0, 0], [6, 0], 30, near, 0, []) === 0, 'a part within sideClear of the tie');
});
