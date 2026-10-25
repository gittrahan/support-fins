/**
 * A part's filament assignment as paint, so a part coloured by FILAMENT keeps its
 * colours through the 3MF export (GitHub #236's other half).
 *
 * A slicer colours a part two ways: painted triangles (threemf.js PAINT_ATTRS),
 * and a filament picked for the whole object or for one of its parts, stated in
 * its config (Bambu/Orca model_settings.config, PrusaSlicer's own). The export
 * writes the part as one object with no config of its own, so a part's filament
 * goes onto its triangles instead: a triangle of a part on filament n is written
 * painted n. That still holds after the parts are merged into one mesh.
 *
 * The paint string is the slicers' shared TriangleSelector code: hex digits read
 * from the END, each a nibble of bits read low bit first. Per node: 2 bits split
 * sides; a split node then has 2 bits special side and (split sides + 1) child
 * nodes, a leaf 2 bits state -- 3 meaning "4 more bits, state = 3 + them". State
 * 0 is "the part's own filament", n > 0 filament n (Bambu and PrusaSlicer alike):
 * a painted triangle's state-0 regions become n, the rest is copied bit for bit.
 */

const MAX_STATE = 18;     // 3 + the 4-bit extension

const bitsOf = (code) => {
  const bits = [];
  for (let i = code.length - 1; i >= 0; i--) {
    const d = parseInt(code[i], 16);
    if (Number.isNaN(d)) return null;
    for (let b = 0; b < 4; b++) bits.push((d >> b) & 1);
  }
  return bits;
};

const codeOf = (bits) => {
  let s = '';
  for (let i = 0; i < bits.length; i += 4) {
    const d = bits[i] | (bits[i + 1] ?? 0) << 1 | (bits[i + 2] ?? 0) << 2 | (bits[i + 3] ?? 0) << 3;
    s = d.toString(16).toUpperCase() + s;
  }
  return s;
};

/** A leaf of state `n`, as bits. */
const leaf = (n) => n < 3
  ? [0, 0, n & 1, n >> 1 & 1]
  : [0, 0, 1, 1, ...[0, 1, 2, 3].map((b) => (n - 3) >> b & 1)];

/** The whole triangle on filament `n` (1 -> "4", 2 -> "8", 3 -> "0C"); null past MAX_STATE. */
export function wholeCode(n) {
  return n >= 1 && n <= MAX_STATE ? codeOf(leaf(n)) : null;
}

/** `code` with its state-0 (the part's filament) regions on filament `n`; null when
 *  the code does not parse -- the caller keeps it as it was. */
export function fillUnpainted(code, n) {
  if (!(n >= 1 && n <= MAX_STATE)) return null;
  const bits = bitsOf(code);
  if (!bits) return null;
  const out = [];
  let i = 0;
  const take = (k) => {
    if (i + k > bits.length) throw 0;
    const s = bits.slice(i, i + k);
    i += k;
    return s;
  };
  const node = () => {
    const split = take(2);
    const sides = split[0] | split[1] << 1;
    if (sides) {
      out.push(...split, ...take(2));
      for (let c = 0; c <= sides; c++) node();
      return;
    }
    const st = take(2);
    if (st[0] && st[1]) out.push(...split, ...st, ...take(4));
    else if (!st[0] && !st[1]) out.push(...leaf(n));
    else out.push(...split, ...st);
  };
  try { node(); } catch { return null; }
  // what is left is the last nibble's padding
  if (bits.length - i >= 4 || bits.slice(i).some(Boolean)) return null;
  return codeOf(out);
}

/**
 * paint(p, n): triangle paint `p` (a PAINT_ATTRS { name, v }, or none) for a
 * triangle of a part on filament `n`. Filament 1 is what the exported part is
 * on anyway, so it changes nothing; an unpainted triangle takes `name`, the
 * file's slicer's own attribute. Each distinct result is one shared object, as
 * the reader shares its paint.
 */
export function filamentPainter(name) {
  const seen = new Map();     // p (or null) -> n -> paint
  return (p, n) => {
    if (!(n > 1)) return p;
    const key = p ?? null;
    let byN = seen.get(key);
    if (!byN) seen.set(key, byN = new Map());
    let out = byN.get(n);
    if (out === undefined) {
      const v = p ? fillUnpainted(p.v, n) : wholeCode(n);
      out = v == null || v === p?.v ? p : { name: p?.name ?? name, v };
      byN.set(n, out);
    }
    return out;
  };
}
