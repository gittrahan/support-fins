/** Closed, non-overlapping material regions for an opt-in support export.
 * The generated soup remains untouched; only the export is partitioned.
 * No mesh repair, material guessing or partially successful export is allowed.
 */
import { manifold } from './cut.js';
import { supportMaterialMesh, SupportMeshError } from './support-material-mesh.js';

const ROLES = ['body', 'interface', 'tine'];

/** A numerical Boolean failure can retry from the original double coordinates;
 * malformed input and missing material identities must not use this retry. */
export class SupportPartitionError extends Error {}

export function indexedSupportMesh(w, triangles) {
  const vertices = [], faces = [], ids = new Map();
  for (let t = 0; t < triangles.length; t += 3) {
    const face = triangles.slice(t, t + 3).map((p) => {
      if (!p || !p.slice(0, 3).every(Number.isFinite)) throw new Error('invalid support coordinate');
      const key = `${p[0]},${p[1]},${p[2]}`;
      if (!ids.has(key)) { ids.set(key, vertices.length / 3); vertices.push(p[0], p[1], p[2]); }
      return ids.get(key);
    });
    if (new Set(face).size === 3) faces.push(...face);
  }
  return new w.Mesh({ numProp: 3, vertProperties: new Float32Array(vertices), triVerts: new Uint32Array(faces) });
}

/** The JS Mesh binding accepts float32 coordinates, while Manifold operates in
 * doubles. Restore the generated coordinates before any Boolean operations:
 * rounding adjacent angled faces independently can create artificial slivers.
 * This changes neither the source triangles nor the preservation tolerance.
 */
export function supportSolid(w, triangles) {
  const original = new Map();
  for (const p of triangles) {
    const key = p.slice(0, 3).map(Math.fround).join(','), old = original.get(key);
    // Shared corners can differ by arithmetic roundoff. A float32 collision
    // between distinct features cannot be reconstructed unambiguously.
    if (old && old.some((v, k) => Math.abs(v - p[k]) >
      64 * Number.EPSILON * Math.max(1, Math.abs(v), Math.abs(p[k])))) {
      throw new Error('support coordinates lose distinct vertices at export precision');
    }
    original.set(key, p.slice(0, 3));
  }
  const source = new w.Manifold(indexedSupportMesh(w, triangles));
  if (!triangles.length) return source;
  try {
    let missing = false;
    const result = source.warp((p) => {
      const q = original.get(p.join(','));
      if (!q) { missing = true; return; }
      for (let k = 0; k < 3; k++) p[k] = q[k];
    });
    if (missing) {
      result.delete();
      throw new Error('support coordinate provenance was lost during mesh construction');
    }
    return result;
  } finally { source.delete(); }
}

/** Untagged auxiliary body geometry is split along exact shared edges only. */
function shells(triangles) {
  const n = triangles.length / 3, up = Int32Array.from({ length: n }, (_, i) => i), edges = new Map();
  const root = (x) => { while (up[x] !== x) x = up[x] = up[up[x]]; return x; };
  const key = (p) => `${p[0]},${p[1]},${p[2]}`;
  for (let t = 0; t < n; t++) for (let k = 0; k < 3; k++) {
    const a = key(triangles[t * 3 + k]), b = key(triangles[t * 3 + (k + 1) % 3]);
    if (a === b) continue;
    const edge = a < b ? `${a}/${b}` : `${b}/${a}`;
    if (!edges.has(edge)) edges.set(edge, []);
    edges.get(edge).push(t);
  }
  for (const ts of edges.values()) if (ts.length === 2) up[root(ts[0])] = root(ts[1]);
  const groups = new Map();
  for (let t = 0; t < n; t++) {
    const id = root(t);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(...triangles.slice(t * 3, t * 3 + 3));
  }
  return [...groups.values()];
}

export function supportSolidGroups(tris) {
  if (tris.length % 3) throw new Error('incomplete support triangle');
  const records = new Map(), plain = [];
  for (let t = 0; t < tris.length; t += 3) {
    const triangle = tris.slice(t, t + 3), record = triangle[0][4];
    if (triangle.some((p) => p[4] !== record)) throw new Error('inconsistent support role triangle');
    if (!record) { plain.push(...triangle); continue; }
    if (!ROLES.includes(record.role)) throw new Error('unknown support role');
    if (!records.has(record)) records.set(record, []);
    records.get(record).push(...triangle);
  }
  return [...records].map(([r, triangles]) => ({ role: r.role, contact: r.contact, triangles }))
    .concat(shells(plain).map((triangles) => ({ role: 'body', triangles })));
}

export function supportSoup(solid) {
  const { vertProperties: p, triVerts: faces, numProp } = solid.getMesh();
  return Array.from(faces, (v) => [p[v * numProp], p[v * numProp + 1], p[v * numProp + 2]]);
}

/** Return named parts in stable body/tine/interface order, and partition evidence. */
export async function partitionSupportMaterials(tris, consume = (result) => result) {
  try { return await partition(tris, consume, false); }
  catch (error) {
    if (!(error instanceof SupportPartitionError) && !(error instanceof SupportMeshError)) throw error;
    return partition(tris, consume, true);
  }
}

async function partition(tris, consume, preserveCoordinates) {
  if (!tris.length) return consume({ parts: [], contacts: [], volume: 0 }, new Map());
  const w = await manifold(), owned = new Set(), groups = new Map(ROLES.map((r) => [r, []]));
  const own = (s) => { owned.add(s); return s; };
  const valid = (s) => {
    if (s.status() !== 'NoError') throw new Error(`invalid support material solid: ${s.status()}`);
    return s;
  };
  try {
    for (const { role, triangles } of supportSolidGroups(tris)) {
      const s = valid(own(preserveCoordinates ? supportSolid(w, triangles) : new w.Manifold(indexedSupportMesh(w, triangles))));
      if (!s.isEmpty()) {
        if (!(s.volume() > 0) || !Number.isFinite(s.volume())) throw new Error('support material source must be outward and have positive volume');
        groups.get(role).push(s);
      }
    }
    const union = (xs) => valid(own(xs.length ? w.Manifold.union(xs) : new w.Manifold(indexedSupportMesh(w, []))));
    const split = (s, cutter) => {
      const parts = s.split(cutter).map(own); // own both even if validation rejects one
      parts.forEach(valid);
      return parts;
    };
    const source = union([...groups.values()].flat());
    // Split each remaining region once into complementary pieces. Independent
    // subtraction orders can disagree along thin coplanar crests (Full wedge
    // X35), losing material when the three independently built parts are united.
    const [tine, rest] = split(source, union(groups.get('tine')));
    const [iface, body] = split(rest, union(groups.get('interface')));
    const result = union([body, tine, iface]);
    // Boolean differences, not summed overlapping input volume: no plastic lost.
    const missing = valid(own(source.subtract(result))), extra = valid(own(result.subtract(source)));
    // Coplanar boolean faces can enclose numerical zero without isEmpty() being
    // true. Use the kernel's actual coordinate tolerance, bounded by the existing
    // 0.01 mm spatial limit, rather than choosing an area-percentage allowance.
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const p of tris) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
    const coordinateTolerance = Math.max(source.tolerance(), result.tolerance());
    if (!Number.isFinite(coordinateTolerance) || coordinateTolerance > .01) throw new Error('support material coordinates exceed export precision');
    const roundoff = Math.max(64 * Number.EPSILON * Math.max(1, ...hi.map((v, k) => v - lo[k])), coordinateTolerance)
      * Math.max(1, source.surfaceArea());
    const missingVolume = Math.abs(missing.volume()), extraVolume = Math.abs(extra.volume());
    if (missingVolume > roundoff || extraVolume > roundoff) {
      throw new SupportPartitionError(`support material partition changed the combined shape (${missingVolume} missing, ${extraVolume} extra mm³; numerical bound ${roundoff})`);
    }
    for (const [a, b] of [[body, tine], [body, iface], [tine, iface]]) {
      if (Math.abs(valid(own(a.intersect(b))).volume()) > roundoff) throw new SupportPartitionError('support materials overlap');
    }
    const solids = new Map([['body', body], ['tine', tine], ['interface', iface]]);
    const parts = [...solids]
      .filter(([, s]) => !s.isEmpty()).map(([role, s]) => ({ role, ...supportMaterialMesh(s) }));
    const records = [...new Set(tris.map((p) => p[4]).filter(Boolean))];
    const contacts = records.filter((r) => r.contact).map((r) => ({ role: r.role, ...structuredClone(r.contact) }));
    // Internal consumers may further partition the live double-precision solids.
    // Reimporting getMesh() here would quantize every Boolean intersection to
    // float32 before matching. Ownership stays here until the consumer completes.
    return await consume({ parts, contacts, volume: source.volume(), residual: { missingVolume, extraVolume, roundoff, coordinateTolerance } }, solids, preserveCoordinates);
  } finally {
    for (const s of owned) s.delete();
  }
}

export const hasSupportRoles = (tris) => tris.some((p) => p[4]?.role === 'tine' || p[4]?.role === 'interface');
