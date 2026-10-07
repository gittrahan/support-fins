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
const { splitInterface } = await import(`${WEB}prop.js`);
const { writeBinarySTL } = await import(`${WEB}stl.js`);
const { MATERIAL } = await import(`${WEB}materials.js`);

// The site's defaults (web/index.html): what an untouched page sends. PLA's
// clearances, so a rung that sets one value leaves the rest where the site starts.
export const SITE = Object.freeze({
  mode: 'auto', bedPad: true, tines: true, tineDensity: 0, layerHeight: 0.2, coverage: 0.5,
});
export const PLA_TUNABLES = Object.freeze({
  padH: MATERIAL.pla.padH, padGrab: MATERIAL.pla.padGrab,
  propGap: MATERIAL.pla.propGap, padStyle: 'auto',
  // PAD.custom's own defaults: what a fresh page sends (style auto never reads them)
  padCustom: { h: 0.5, gap: 0.0, grip: 0.05, margin: 4.0 }, cutout: 'none',
  // the tine shape knobs' defaults (tine coupon): reset every rung, they persist
  tinesPerWall: 0,
  // Interface material off, and its calibration knobs' defaults (interface coupon)
  iface: false, ifaceW: 1.0, ifaceGap: null,
});

function readSTL(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), n = dv.getUint32(80, true);
  const pos = new Float32Array(n * 9);
  for (let f = 0; f < n; f++) for (let i = 0; i < 9; i++) pos[f * 9 + i] = dv.getFloat32(84 + f * 50 + 12 + i * 4, true);
  return pos;
}

/** gen.py's part and rungs, analysed the way the site analyses an import. */
export function loadCoupon(dir, file = 'coupon_part.stl') {
  const out = new URL('./out/', dir).pathname;
  const pos = readSTL(Deno.readFileSync(`${out}${file}`));
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

/** The connected pieces of a vertex list (3 per triangle): triangles sharing a
 *  vertex are one piece. Returns arrays of triangle indices. */
function pieces(verts) {
  const n = verts.length / 3, parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const owner = new Map();
  for (let t = 0; t < n; t++) {
    for (let k = 0; k < 3; k++) {
      const v = verts[t * 3 + k], key = `${v[0]},${v[1]},${v[2]}`;
      if (owner.has(key)) parent[find(t)] = find(owner.get(key)); else owner.set(key, t);
    }
  }
  const groups = new Map();
  for (let t = 0; t < n; t++) {
    const r = find(t);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(t);
  }
  return [...groups.values()];
}

/** Support pieces (whole connected bodies, never cut) whose bounding-box centre is
 *  inside the rung's x/y box, given in gen.py's frame: [x0, x1, y0, y1]. Cutting
 *  by triangle left open edges where a wall's foot crossed the box. */
export function keep(c, verts, [x0, x1, y0, y1]) {
  const kept = [];
  for (const tris of pieces(verts)) {
    let lx = Infinity, hx = -Infinity, ly = Infinity, hy = -Infinity;
    for (const t of tris) for (let k = 0; k < 3; k++) {
      const v = verts[t * 3 + k];
      lx = Math.min(lx, v[0]); hx = Math.max(hx, v[0]); ly = Math.min(ly, v[1]); hy = Math.max(hy, v[1]);
    }
    const cx = (lx + hx) / 2 - c.off.x, cy = (ly + hy) / 2 - c.off.y;
    if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) for (const t of tris) kept.push(verts[t * 3], verts[t * 3 + 1], verts[t * 3 + 2]);
  }
  return kept;
}

/** Throws unless every directed edge a->b is matched by as many b->a: closed,
 *  consistently wound bodies, what a slicer needs and what the site exports. Not
 *  "every edge used exactly twice": a cut wall (Walls > Cutouts) is several closed
 *  solids -- bands, posts, cells, stacked slabs -- that share edges (4 or 6 uses).
 *  A hole leaves an edge unmatched, and so does a flipped body. */
export function assertClosed(verts, what) {
  const edges = new Map();
  for (let i = 0; i < verts.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const e = `${verts[i + k]}|${verts[i + (k + 1) % 3]}`;
      edges.set(e, (edges.get(e) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const [e, n] of edges) {
    const [a, b] = e.split('|');
    if ((edges.get(`${b}|${a}`) ?? 0) !== n) open++;
  }
  if (open) throw new Error(`${what}: ${open} edges not matched by a reverse edge (a hole or a flipped body)`);
}

/** All of a build's support triangles: walls, wedges, braces and the bed pad. */
export const supportOf = (built) => [...(built.triangles ?? []), ...(built.padTriangles ?? [])];

/** out/<name>-coupon.3mf (part and supports as two objects in register, the site's
 *  Export > 3MF since #199; an interface crest as a part of the supports), .stl
 *  (merged), -fins.stl. */
export async function writeCoupon(c, name, title, sup) {
  assertClosed(sup, `${name} supports`);
  const bytes = async (blob) => new Uint8Array(await blob.arrayBuffer());
  // an interface crest (prop/crest.js) is a part of the supports object, as the site
  // writes it; a coupon without one writes exactly as before
  const { body, iface } = splitInterface(sup);
  Deno.writeFileSync(`${c.out}${name}-coupon.3mf`, await bytes(writeThreeMF(c.part, body, title, { separate: true, iface })));
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
