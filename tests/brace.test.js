// BRACES (web/prop/brace.js, local issue 036): a fill wall far taller than it is long
// stood on a flange at most 6 mm across, or none at all (a part-attached wall run down
// to the plate). Ribs at the plate brace it; they must stay under the tip taper so the
// contact and its breakaway are untouched, land only on the plate, and leave a stocky
// wall alone.
import { assert } from './_util.js';
import { BRACE, braceWall, PROP } from '../web/prop.js';

const NONE = new Float32Array(0);                    // no part: every rib fits
const line = (len, z) => [0, 1, 2, 3].map((k) => [len * k / 3, 0, z]);
const box = (tris) => {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const v of tris) for (let k = 0; k < 3; k++) { b[k] = Math.min(b[k], v[k]); b[k + 3] = Math.max(b[k + 3], v[k]); }
  return b;
};

Deno.test('brace: a 3 mm wall 30 mm tall on the plate gets four ribs, all under its tip', () => {
  const out = [];
  const top = line(3, 30);
  const n = braceWall(top, () => 0, NONE, 0, out);
  assert(n === 4, `ribs ${n}`);
  const b = box(out);
  assert(b[2] >= -1e-9, 'nothing under the plate');
  assert(b[5] <= 30 - PROP.gap - PROP.tipH - 1 + 1e-9, `ribs stop under the tip taper (top ${b[5].toFixed(2)})`);
  // the footprint now reaches footRatio x height past the wall's ends
  const reach = PROP.footRatio * (30 - PROP.gap);
  assert(b[3] - b[0] >= 3 + 2 * reach - 1e-6, `footprint ${(b[3] - b[0]).toFixed(1)} mm along the line`);
  // every rib and flange is a closed solid wound outward: each block's signed volume
  // is its own volume, positive (a flipped frame would read negative)
  const stem = BRACE.rise * (30 - PROP.gap);
  const rib = 0.5 * stem * (reach + PROP.th / 2) * PROP.th;
  const flange = (reach + PROP.th / 2) * 2 * PROP.footMin * PROP.baseH;
  for (let i = 0; i < out.length; i += 24 + 36) {
    const v = (from, to) => {
      let s = 0;
      for (let j = from; j < to; j += 3) {
        const [a, c, d] = [out[j], out[j + 1], out[j + 2]];
        s += a[0] * (c[1] * d[2] - c[2] * d[1]) - a[1] * (c[0] * d[2] - c[2] * d[0]) + a[2] * (c[0] * d[1] - c[1] * d[0]);
      }
      return s / 6;
    };
    assert(Math.abs(v(i, i + 24) - rib) < 1e-6, `rib volume ${v(i, i + 24).toFixed(3)} vs ${rib.toFixed(3)}`);
    assert(Math.abs(v(i + 24, i + 60) - flange) < 1e-6, `flange volume ${v(i + 24, i + 60).toFixed(3)} vs ${flange.toFixed(3)}`);
  }
});

Deno.test('brace: a part on the plate just past a rib\'s tip keeps sideClear off it (review)', () => {
  // a 5 mm block resting on the plate 0.1 mm beyond where the +x end rib would land:
  // checked only to its tip, the rib's flange stopped 0.05 mm from the part and fused
  const reach = PROP.footRatio * (30 - PROP.gap);
  const x0 = 3 + reach + 0.1, x1 = x0 + 5, y0 = -5, y1 = 5, z1 = 5;
  const q = (a, b, c, d) => [...a, ...b, ...c, ...a, ...c, ...d];
  const P = (x, y, z) => [x, y, z];
  const block = new Float32Array([
    ...q(P(x0, y0, 0), P(x0, y1, 0), P(x1, y1, 0), P(x1, y0, 0)),
    ...q(P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)),
    ...q(P(x0, y0, 0), P(x1, y0, 0), P(x1, y0, z1), P(x0, y0, z1)),
    ...q(P(x0, y1, 0), P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, 0)),
    ...q(P(x0, y0, 0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, 0)),
    ...q(P(x1, y0, 0), P(x1, y1, 0), P(x1, y1, z1), P(x1, y0, z1)),
  ]);
  const out = [];
  braceWall(line(3, 30), () => 0, block, 0, out);
  const b = box(out);
  assert(b[3] <= x0 - PROP.sideClear + 1e-9, `ribs end ${(x0 - b[3]).toFixed(2)} mm from the block, need ${PROP.sideClear}`);
});

Deno.test('brace: a stocky wall, or one standing on the part, gets none', () => {
  assert(braceWall(line(10, 30), () => 0, NONE, 0, []) === 0, `under ${BRACE.aspect}:1 is left alone`);
  assert(braceWall(line(3, 30), () => 12, NONE, 0, []) === 0, 'a floor on the part is not braced (v1)');
});

Deno.test('brace: a rib the caller rejects (another support in the way) is not built', () => {
  const out = [];
  let asked = 0;
  assert(braceWall(line(3, 30), () => 0, NONE, 0, out, () => { asked++; return false; }) === 0, 'no rib built');
  assert(out.length === 0, 'nothing appended');
  assert(asked >= 4, 'each rib, at each reach, is offered to the caller');
});
