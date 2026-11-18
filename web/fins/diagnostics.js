// Serializable diagnostic context and reports; no geometry/runtime dependency.
const POSITIVE = ['layerHeight', 'firstLayerHeight', 'lineWidth', 'firstLayerWidth', 'nozzle'];
/** Uniform fixed layers, indexed from zero. Z is the extrusion's TOP height. */
export function layerAt(index, context) {
  const height = index === 0 ? context.firstLayerHeight : context.layerHeight;
  const printZ = context.firstLayerHeight + index * context.layerHeight;
  const z = (context.plateZ ?? 0) + printZ;
  return { index, z, printZ, height, sliceZ: z - height / 2,
    width: index === 0 ? context.firstLayerWidth : context.lineWidth };
}

export function checkedContext(raw) {
  if (!raw || raw.unavailable) throw new Error(raw?.unavailable ?? 'print settings unavailable');
  for (const key of POSITIVE) if (!(Number.isFinite(raw[key]) && raw[key] > 0)) throw new Error(`invalid ${key}`);
  if (!Number.isFinite(raw.bottomGap) || raw.bottomGap < 0) throw new Error('invalid bottomGap');
  if (raw.plateZ !== undefined && !Number.isFinite(raw.plateZ)) throw new Error('invalid plateZ');
  if (raw.layerHeight > raw.nozzle || raw.firstLayerHeight > raw.nozzle) throw new Error('layer height exceeds nozzle diameter');
  return { ...Object.fromEntries([...POSITIVE, 'bottomGap', 'basis'].map((k) => [k, raw[k]])), plateZ: raw.plateZ ?? 0 };
}

/**
 * Internal context for callers without a saved slicer profile. Nozzle diameter
 * is explicitly a width proxy; this must not be reported as resolved extrusion
 * settings. Preserved projects pass their saved ordinary-mesh widths instead.
 */
export function nominalContext(layerHeight, nozzle, bottomGap) {
  return { layerHeight, firstLayerHeight: layerHeight, nozzle,
    lineWidth: nozzle, firstLayerWidth: nozzle, bottomGap, basis: 'nozzle-proxy' };
}

/** Counted, locatable findings. Intentional model seats, narrow-to-wide transitions and
 * geometric growth remain in the full report. Growth alone has not established missing/floating
 * extrusion, so it must not inflate the headline count or its navigation. */
export function supportFindings(report) {
  if (!report) return [];
  return [...report.starts.filter((s) => s.root === 'unresolved').map((s) => ({ ...s, kind: 'start' })),
    ...report.narrow.map((s) => ({ ...s, kind: 'narrow' }))]
    .sort((a, b) => a.layer - b.layer || a.piece.localeCompare(b.piece) || a.kind.localeCompare(b.kind));
}

/** Compact, cacheable host statistics. Existing model-island counts stay separate. */
export function printabilityStats(report) {
  if (!report) return {};
  const findings = supportFindings(report);
  return { supportCheck: report.status, supportFindings: findings.length,
    supportFirstZ: findings.length ? findings.reduce((z, f) => Math.min(z, f.printZ), Infinity) : null };
}

/** Validate the compact representation before accepting a completed checkpoint. */
export function validDiagnostics(d) {
  if (!d || typeof d !== 'object') return false;
  if (!d.offset || !['x', 'y', 'z'].every((k) => Number.isFinite(d.offset[k]))) return false;
  const s = d.support;
  if (s?.version !== 1 || !['complete', 'incomplete', 'unavailable'].includes(s.status)
      || !Number.isSafeInteger(s.layers) || s.layers < 0 || s.layers > 20001) return false;
  if (s.status !== 'unavailable') {
    try { checkedContext(s.context); } catch { return false; }
  }
  if (s.status !== 'complete' && typeof s.stopped?.reason !== 'string') return false;
  let count = 0;
  for (const key of ['starts', 'growth', 'narrow']) {
    if (!Array.isArray(s[key])) return false;
    count += s[key].length;
    for (const f of s[key]) {
      if (typeof f.piece !== 'string' || !Number.isSafeInteger(f.layer) || f.layer < 0
          || !Number.isFinite(f.z) || !Number.isFinite(f.printZ) || !Number.isFinite(f.sliceZ) || !Number.isFinite(f.area) || f.area < 0
          || !Array.isArray(f.bounds) || f.bounds.length !== 4 || !f.bounds.every(Number.isFinite)
          || f.bounds[0] > f.bounds[2] || f.bounds[1] > f.bounds[3]) return false;
      if (key === 'starts' && (!['plate', 'support', 'model-below', 'narrow-below', 'unresolved'].includes(f.root)
          || !Array.isArray(f.parents) || f.parents.some((p) => typeof p !== 'string'))) return false;
      if (key === 'narrow' && !(Number.isFinite(f.width) && f.width > 0)) return false;
    }
  }
  if (count > 100000) return false;
  const c = d.coverage;
  return c?.basis === 'sampled-contact-reach' && Number.isFinite(c.area) && c.area >= 0
    && Number.isFinite(c.total) && c.total >= 0 && Array.isArray(c.points)
    && c.points.every((p) => Array.isArray(p) && p.length === 4 && p.every(Number.isFinite) && p[3] >= 0)
    && Array.isArray(c.sourceFaces) && c.sourceFaces.length === c.points.length
    && c.sourceFaces.every((faces) => Array.isArray(faces) && faces.length > 0 && faces.every((f) => Number.isSafeInteger(f) && f >= 0))
    && Array.isArray(c.contacts) && c.contacts.every((contact) => typeof contact.piece === 'string'
      && Array.isArray(contact.points) && contact.points.every((p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)));
}
