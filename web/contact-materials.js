/** Project/browser export only: map exact source paint regions across contact
 * footprints. Bodies keep a fixed identity; uncovered or ambiguous regions use
 * the explicit fallback. This does not reconstruct interior slicer materials.
 */
import { manifold } from './cut.js';
import {
  indexedSupportMesh,
  partitionSupportMaterials,
  SupportPartitionError,
  supportSolid,
  supportSolidGroups,
  supportSoup,
} from './support-materials.js';

const dot = (a, b) => a.reduce((n, v, k) => n + v * b[k], 0);
const sub = (a, b) => a.slice(0, 3).map((v, k) => v - b[k]);
const cross = (
  a,
  b,
) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v) => {
  const l = Math.hypot(...v);
  if (!l || !Number.isFinite(l)) throw new Error('invalid contact direction');
  return v.map((x) => x / l);
};
const area = (p) =>
  p.reduce((s, a, i) => {
    const b = p[(i + 1) % p.length];
    return s + a[0] * b[1] - a[1] * b[0];
  }, 0) / 2;
const ccw = (p) => area(p) < 0 ? p.toReversed() : p;
const bounds = (points) => {
  const b = { lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] };
  for (const p of points) {
    for (let k = 0; k < 3; k++) {
      b.lo[k] = Math.min(b.lo[k], p[k]);
      b.hi[k] = Math.max(b.hi[k], p[k]);
    }
  }
  return b;
};
const overlaps = (a, b, eps) => a.lo.every((v, k) => v <= b.hi[k] + eps && a.hi[k] >= b.lo[k] - eps);
function clip(p, side) {
  const out = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], da = side(a), db = side(b);
    if (da >= 0) out.push(a);
    if ((da < 0) !== (db < 0)) {
      const t = da / (da - db);
      out.push(a.map((v, k) => v + t * (b[k] - v)));
    }
  }
  return out.length >= 3 && area(out) > 0 ? out : [];
}
function intersect(a, b) {
  for (let i = 0; i < b.length && a.length; i++) {
    const p = b[i], q = b[(i + 1) % b.length];
    a = clip(a, (r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  }
  return a;
}
function plane(t) {
  const n = cross(sub(t[1], t[0]), sub(t[2], t[0]));
  if (Math.abs(n[2]) <= Number.EPSILON * Math.hypot(...n)) return null;
  return (p) => t[0][2] - (n[0] * (p[0] - t[0][0]) + n[1] * (p[1] - t[0][1])) / n[2];
}
function regionIndex(regions) {
  const items = regions.map((r) => ({ ...r, box: bounds(r.triangle) }));
  function tree(xs) {
    if (!xs.length) return null;
    const box = { lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] };
    for (const x of xs) {
      for (let k = 0; k < 3; k++) {
        box.lo[k] = Math.min(box.lo[k], x.box.lo[k]);
        box.hi[k] = Math.max(box.hi[k], x.box.hi[k]);
      }
    }
    if (xs.length < 16) return { box, items: xs };
    const axis = [0, 1, 2].sort((a, b) => (box.hi[b] - box.lo[b]) - (box.hi[a] - box.lo[a]))[0];
    xs.sort((a, b) => a.box.lo[axis] + a.box.hi[axis] - b.box.lo[axis] - b.box.hi[axis]);
    const m = xs.length >> 1;
    return { box, left: tree(xs.slice(0, m)), right: tree(xs.slice(m)) };
  }
  const root = tree(items);
  return (box, eps) => {
    const out = [], queue = root ? [root] : [];
    while (queue.length) {
      const n = queue.pop();
      if (!overlaps(n.box, box, eps)) continue;
      if (n.items) out.push(...n.items.filter((r) => overlaps(r.box, box, eps)));
      else queue.push(n.left, n.right);
    }
    return out;
  };
}

/** Source regions and support solids must share one millimetre coordinate frame.
 * maxDistance bounds surface association only; paint boundaries are not expanded.
 * No RGB matching, nearest-face selection or majority-colour sampling is used.
 */
export async function matchContactMaterials(
  triangles,
  { regions, bodyMaterial, fallbackMaterial, maxDistance = .01 },
) {
  if (
    typeof bodyMaterial !== 'string' || !bodyMaterial || typeof fallbackMaterial !== 'string' ||
    !fallbackMaterial
  ) throw new Error('body and fallback material identities are required');
  if (!Array.isArray(regions) || !(maxDistance >= 0) || !Number.isFinite(maxDistance)) {
    throw new Error('invalid source material regions');
  }
  for (const r of regions) {
    if (
      r.triangle?.length !== 3 || r.triangle.some((p) => p.length !== 3 || !p.every(Number.isFinite)) ||
      r.material !== null && typeof r.material !== 'string'
    ) throw new Error('invalid source material region');
  }
  return partitionSupportMaterials(triangles, async (base, liveParts, preserveCoordinates) => {
    const w = await manifold(),
      groups = supportSolidGroups(triangles),
      query = regionIndex(regions),
      parts = [],
      diagnostics = [];
    for (const part of base.parts) {
      if (part.role === 'body') {
        parts.push({ ...part, material: bodyMaterial });
        continue;
      }
      const owned = new Set(),
        own = (s) => {
          owned.add(s);
          if (s.status() !== 'NoError') throw new Error('invalid matched support solid');
          return s;
        };
      const release = (s) => {
        owned.delete(s);
        s.delete();
      };
      const mesh = (tris) =>
        own(preserveCoordinates ? supportSolid(w, tris) : new w.Manifold(indexedSupportMesh(w, tris)));
      const union = (solids) =>
        own(solids.length ? w.Manifold.union(solids) : new w.Manifold(indexedSupportMesh(w, [])));
      try {
        const source = liveParts.get(part.role), materials = new Map();
        for (const group of groups.filter((g) => g.role === part.role && g.contact)) {
          const { direction, surfaceOffset = 0 } = group.contact;
          if (!Number.isFinite(surfaceOffset)) throw new Error('invalid contact surface offset');
          const footprint = group.contact.footprint?.map((p) =>
            p.map((v, k) => v + direction[k] * surfaceOffset)
          );
          if (
            !Array.isArray(footprint) || footprint.length < 3 ||
            footprint.some((p) => p.length !== 3 || !p.every(Number.isFinite))
          ) throw new Error('invalid contact footprint');
          const z = unit(direction),
            axis = Math.abs(z[2]) < .9 ? [0, 0, 1] : [0, 1, 0],
            x = unit(cross(axis, z)),
            y = cross(z, x),
            origin = footprint[0];
          const local = (p) => {
            const d = sub(p, origin);
            return [dot(d, x), dot(d, y), dot(d, z)];
          };
          const world = (p) => origin.map((v, k) => v + p[0] * x[k] + p[1] * y[k] + p[2] * z[k]);
          const ring = footprint.map(local), outline = ccw(ring.map((p) => p.slice(0, 2)));
          // Preserve original corner-depth correspondence if winding was reversed.
          const ordered = area(ring) < 0 ? ring.toReversed() : ring;
          const faces = w.triangulate([outline], 0, false);
          const solid = mesh(group.triangles);
          let lo = Infinity, hi = -Infinity;
          for (const p of group.triangles) {
            const depth = local(p)[2];
            lo = Math.min(lo, depth - 1);
            hi = Math.max(hi, depth + 1);
          }
          for (const region of query(bounds(footprint), maxDistance)) {
            const material = Object.hasOwn(region.roleMaterials ?? {}, part.role)
              ? region.roleMaterials[part.role]
              : region.material;
            const t = region.triangle.map(local), surface = plane(t);
            if (!surface) continue;
            const polygon = ccw(t.map((p) => p.slice(0, 2)));
            for (const ids of faces) {
              const anchor = ids.map((i) => ordered[i]), contact = plane(anchor);
              if (!contact) continue;
              let p = intersect(ccw(anchor.map((v) => v.slice(0, 2))), polygon);
              p = clip(p, (q) => maxDistance - (surface(q) - contact(q)));
              p = clip(p, (q) => maxDistance + (surface(q) - contact(q)));
              if (!p.length) continue;
              // Convex prism, with the painted region projected through this
              // contact solid. Closed solids are intersected by the same kernel
              // used for role partitioning; no open triangle clipping is exported.
              const verts = [];
              const push = (...pts) => verts.push(...pts.map(world));
              for (let i = 1; i < p.length - 1; i++) {
                push([...p[0], lo], [...p[i + 1], lo], [...p[i], lo]);
                push([...p[0], hi], [...p[i], hi], [...p[i + 1], hi]);
              }
              for (let i = 0; i < p.length; i++) {
                const a = p[i], b = p[(i + 1) % p.length];
                push([...a, lo], [...b, lo], [...b, hi]);
                push([...a, lo], [...b, hi], [...a, hi]);
              }
              const mask = mesh(verts), hit = own(solid.intersect(mask));
              release(mask);
              if (!hit.isEmpty()) {
                if (!materials.has(material)) materials.set(material, []);
                materials.get(material).push(hit);
              }
            }
          }
          release(solid);
        }
        const labeled = [...materials].sort(([a], [b]) =>
          String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0
        ).map(([material, solids]) => ({ material, solid: union(solids) }));
        const conflicts = [];
        for (let i = 0; i < labeled.length; i++) {
          for (let j = i + 1; j < labeled.length; j++) {
            conflicts.push(own(labeled[i].solid.intersect(labeled[j].solid)));
          }
        }
        const ambiguous = union(conflicts), assigned = [];
        let rest = source, unresolvedVolume = 0;
        for (const { material, solid } of labeled) {
          const clear = own(solid.subtract(ambiguous)), pair = rest.split(clear);
          pair.forEach((s) => owned.add(s));
          pair.forEach(own);
          const [hit, remainder] = pair;
          rest = remainder;
          if (!hit.isEmpty()) {
            assigned.push({ material: material ?? fallbackMaterial, solid: hit });
            if (material === null) unresolvedVolume += Math.abs(hit.volume());
          }
        }
        const numerical = Math.max(source.tolerance(), Number.EPSILON * 64) *
          Math.max(1, source.surfaceArea());
        unresolvedVolume += Math.abs(rest.volume());
        if (unresolvedVolume > numerical) {
          diagnostics.push({
            role: part.role,
            code: 'unresolved-contact-material',
            volume: unresolvedVolume,
          });
        }
        if (!rest.isEmpty()) assigned.push({ material: fallbackMaterial, solid: rest });
        const byMaterial = new Map();
        for (const a of assigned) {
          if (!byMaterial.has(a.material)) byMaterial.set(a.material, []);
          byMaterial.get(a.material).push(a.solid);
        }
        const result = [];
        for (
          const [material, solids] of [...byMaterial].sort(([a], [b]) =>
            String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0
          )
        ) {
          const s = union(solids);
          result.push(s);
          parts.push({ role: part.role, material, triangles: supportSoup(s) });
        }
        const complete = union(result);
        for (const delta of [own(source.subtract(complete)), own(complete.subtract(source))]) {
          if (Math.abs(delta.volume()) > numerical) {
            throw new SupportPartitionError('contact material partition changed support geometry');
          }
        }
      } finally {
        for (const s of owned) s.delete();
      }
    }
    return { parts, diagnostics };
  });
}
