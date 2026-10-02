/**
 * Shared engine side of the calibration coupons' build.js scripts: load gen.py's
 * part, run the SAME call the site makes -- analyze(topo, 45, rot), then
 * buildFins(..., { mode: 'auto', bedPad: true, ... }) with the site's defaults --
 * once per rung with that rung's setting, keep the support triangles inside the
 * rung's box, and write the 3MF (part + supports as separate objects) and STLs.
 *
 * Coordinates: gen.py works in the part's own frame; buildFins returns the seated
 * frame (posed + offset). `rungBox` and `keep` handle the shift.
 */
const WEB = new URL('../../web/', import.meta.url).pathname;
const { buildTopology, analyze } = await import(`${WEB}overhangs.js`);
const { buildFins } = await import(`${WEB}fins.js`);
const { writeThreeMF } = await import(`${WEB}threemf.js`);
const { writeBinarySTL } = await import(`${WEB}stl.js`);
const { MATERIAL } = await import(`${WEB}materials.js`);

// The site's defaults (web/index.html): what an untouched page sends. PLA's
// clearances, so a rung that sets one value leaves the rest where the site starts.
export const SITE = Object.freeze({
  mode: 'auto', bedPad: true, tines: true, tineDensity: 0.5, layerHeight: 0.2, coverage: 0.5,
});
export const PLA_TUNABLES = Object.freeze({
  tineBite: MATERIAL.pla.tineBite, padH: MATERIAL.pla.padH, padGrab: MATERIAL.pla.padGrab,
  propGap: MATERIAL.pla.propGap, padStyle: 'auto',
  // Custom starts from Light's numbers (ui/settings.js padPreset), as the page does
  padCustom: { h: 0.2, gap: 0.12, grip: 0, margin: 4.0 }, cutout: 'none',
});

function readSTL(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), n = dv.getUint32(80, true);
  const pos = new Float32Array(n * 9);
  for (let f = 0; f < n; f++) for (let i = 0; i < 9; i++) pos[f * 9 + i] = dv.getFloat32(84 + f * 50 + 12 + i * 4, true);
  return pos;
}

/** gen.py's part and rungs, analysed the way the site analyses an import. */
export function loadCoupon(dir) {
  const out = new URL('./out/', dir).pathname;
  const pos = readSTL(Deno.readFileSync(`${out}coupon_part.stl`));
  const topo = buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
  const rot = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const result = analyze(topo, 45, rot);
  const off = result.offset;
  const part = [];
  for (let i = 0; i < pos.length; i += 3) part.push([pos[i] + off.x, pos[i + 1] + off.y, pos[i + 2] + off.z]);
  const rungs = JSON.parse(Deno.readTextFileSync(`${out}rungs.json`));
  return { out, topo, rot, result, off, part, rungs };
}

/** buildFins with the site's defaults, `opts` on top (tunables merged over PLA's). */
export function finsWith(c, opts = {}) {
  const { tunables, ...rest } = opts;
  return buildFins(c.topo, c.result, c.rot,
    { ...SITE, ...rest, tunables: { ...PLA_TUNABLES, ...tunables } });
}

/** Support triangles (vertex list, 3 per triangle) whose centroid is inside the
 *  rung's x/y box, given in gen.py's frame: [x0, x1, y0, y1]. */
export function keep(c, verts, [x0, x1, y0, y1]) {
  const kept = [];
  for (let i = 0; i < verts.length; i += 3) {
    const cx = (verts[i][0] + verts[i + 1][0] + verts[i + 2][0]) / 3 - c.off.x;
    const cy = (verts[i][1] + verts[i + 1][1] + verts[i + 2][1]) / 3 - c.off.y;
    if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) kept.push(verts[i], verts[i + 1], verts[i + 2]);
  }
  return kept;
}

/** All of a build's support triangles: walls, wedges, braces and the bed pad. */
export const supportOf = (built) => [...(built.triangles ?? []), ...(built.padTriangles ?? [])];

/** out/<name>-coupon.3mf (part + supports as two objects), .stl (merged), -fins.stl. */
export async function writeCoupon(c, name, title, sup) {
  const bytes = async (blob) => new Uint8Array(await blob.arrayBuffer());
  Deno.writeFileSync(`${c.out}${name}-coupon.3mf`, await bytes(writeThreeMF(c.part, sup, title)));
  Deno.writeFileSync(`${c.out}${name}-coupon.stl`, await bytes(writeBinarySTL([...c.part, ...sup], title)));
  if (sup.length) Deno.writeFileSync(`${c.out}${name}-fins.stl`, await bytes(writeBinarySTL(sup, `${title} supports`)));
  console.log(`wrote ${c.out}${name}-coupon.3mf (+ .stl${sup.length ? ', supports-only .stl' : ''})`);
}

/** The build's fin records whose line starts inside the rung's box (gen.py frame). */
export function finsIn(c, built, [x0, x1, y0, y1]) {
  return (built.fins ?? []).filter((f) => {
    const p = f.line?.[0];
    if (!p) return false;
    const x = p[0] - c.off.x, y = p[1] - c.off.y;
    return x >= x0 && x <= x1 && y >= y0 && y <= y1;
  });
}
