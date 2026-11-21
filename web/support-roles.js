/** Optional semantic records for closed generated support solids.
 *
 * Coordinates and the legacy interface flag (vertex[3]) retain their meanings.
 * vertex[4] is a shared record for ONE emitted solid, carried by structured clone
 * and vertex.slice() through workers, removal and plate placement. Only the new
 * opt-in material export records it; ordinary builds allocate nothing here.
 * Contacts are in the same print space as the vertices; placement moves both.
 */
import { PROP } from './prop/config.js';

export const separateSupportRoles = () => PROP.tineDir !== 'vertical'
  && (PROP.iface === 'tines' || PROP.separateTines === true);

export function recordSupportSolid(out, from = 0) {
  if (!separateSupportRoles() || from === out.length) return;
  // An outer orientation/append helper may receive an already recorded solid.
  if (out.slice(from).every((p) => p[4])) return;
  const record = { role: 'body' }, vertices = new Map();
  for (let i = from; i < out.length; i++) {
    const p = out[i];
    if (!vertices.has(p)) vertices.set(p, [p[0], p[1], p[2], p[3] ?? 0, record]);
    out[i] = vertices.get(p);
  }
}

/** Contact describes the generated attachment, not a guessed source material. */
export function markSupportRole(out, from, role, contact = null) {
  if (!separateSupportRoles()) return;
  if (!['tine', 'interface'].includes(role)) throw new Error('invalid support role');
  recordSupportSolid(out, from);
  for (let i = from; i < out.length; i++) {
    const record = out[i][4];
    record.role = role;
    out[i][3] = 1; // the existing interface preview; role identity stays separate
    if (contact) record.contact = contact;
  }
}

/** Translate support vertices and their optional contact records together. */
export function moveSupportTriangles(tris, x, y) {
  const records = new Map();
  const point = (p) => [p[0] + x, p[1] + y, p[2]];
  return tris.map((p) => {
    const q = p.slice(); q[0] += x; q[1] += y;
    if (p[4]) {
      if (!records.has(p[4])) {
        const r = p[4];
        records.set(r, { ...r, ...(r.contact ? { contact: { ...r.contact,
          footprint: r.contact.footprint.map(point) } } : {}) });
      }
      q[4] = records.get(p[4]);
    }
    return q;
  });
}
