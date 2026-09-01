// Shared test helpers. No network deps -- a tiny local assert so `deno test
// --allow-read tests/` runs offline. The support engine is pure geometry, so
// every test is: build some geometry, assert an invariant on the triangle soup.

export const WEB = new URL('../web/', import.meta.url).pathname;
export const MODELS = new URL('../prototype/stress/models/', import.meta.url).pathname;

export const { buildTopology, analyze } = await import(`${WEB}overhangs.js`);
export const fins = await import(`${WEB}fins.js`);
export const prop = await import(`${WEB}prop.js`);
export const { insidePart } = await import(`${WEB}inside.js`);

// --- assertions -----------------------------------------------------------
export function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
export function assertClose(a, b, tol, msg) {
  if (Math.abs(a - b) > tol) throw new Error(`${msg || 'not close'}: ${a} vs ${b} (tol ${tol})`);
}

// --- STL + geometry --------------------------------------------------------
export function readSTL(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = dv.getUint32(80, true);
  const pos = new Float32Array(n * 9);
  for (let f = 0; f < n; f++) {
    const o = 84 + f * 50 + 12;
    for (let i = 0; i < 9; i++) pos[f * 9 + i] = dv.getFloat32(o + i * 4, true);
  }
  return pos;
}

export function loadModel(name) {
  const pos = readSTL(Deno.readFileSync(`${MODELS}${name}.stl`));
  return buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
}

/** A solid axis-aligned block as a closed triangle-soup position array. */
export function block(x0, x1, y0, y1, z0, z1) {
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
             [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const q = (a, b, c, d) => [v[a], v[b], v[c], v[a], v[c], v[d]];
  const t = [...q(0, 3, 2, 1), ...q(4, 5, 6, 7), ...q(0, 1, 5, 4),
             ...q(2, 3, 7, 6), ...q(1, 2, 6, 5), ...q(0, 4, 7, 3)];
  const arr = new Float32Array(t.length * 3);
  let i = 0;
  for (const p of t) { arr[i++] = p[0]; arr[i++] = p[1]; arr[i++] = p[2]; }
  return arr;
}
export function blockTopo(...args) {
  const pos = block(...args);
  return buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
}

// --- rotations (column-major 3x3, THREE.Matrix3.elements order) -----------
const d2r = (d) => (d * Math.PI) / 180;
export const rotX = (d) => { const c = Math.cos(d2r(d)), s = Math.sin(d2r(d)); return [1, 0, 0, 0, c, s, 0, -s, c]; };
export const rotY = (d) => { const c = Math.cos(d2r(d)), s = Math.sin(d2r(d)); return [c, 0, -s, 0, 1, 0, s, 0, c]; };

// --- invariant helpers -----------------------------------------------------
/** How many of these [x,y,z] verts are strictly inside the seated part. */
export function insideCount(topo, rot, offset, tris) {
  let c = 0;
  for (const v of tris) if (insidePart(topo, rot, offset, v[0], v[1], v[2])) c++;
  return c;
}

/** Is the triangle-soup a closed surface (every undirected edge shared evenly)? */
export function isClosed(tris) {
  if (!tris.length) return true;
  const key = (p) => `${Math.round(p[0] * 1e3)},${Math.round(p[1] * 1e3)},${Math.round(p[2] * 1e3)}`;
  const edges = new Map();
  for (let i = 0; i < tris.length; i += 3) {
    for (let e = 0; e < 3; e++) {
      const a = key(tris[i + e]), b = key(tris[i + (e + 1) % 3]);
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  }
  for (const c of edges.values()) if (c % 2 !== 0) return false;
  return true;
}

/** axis-aligned bounding box of a [x,y,z] vert list */
export function bbox(tris) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const v of tris) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[k]); hi[k] = Math.max(hi[k], v[k]); }
  return { lo, hi };
}
