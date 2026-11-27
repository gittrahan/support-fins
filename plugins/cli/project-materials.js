// Project-only role assignments. Source palettes and models remain untouched.
import { partitionSupportMaterials } from '../../web/support-materials.js';
import { validateProjectMaterialParts } from './project-material-records.js';
export { validateProjectMaterialParts } from './project-material-records.js';

export const roleMaterialsRequested = (args) => args.tineExtruder != null || args.interfaceExtruder != null;

export function projectMaterialSlots(settings, args, body) {
  if (!roleMaterialsRequested(args)) return null;
  const count = Array.isArray(settings.filament_colour) ? settings.filament_colour.length : 0;
  const slots = { body, tine: args.tineExtruder ?? body, interface: args.interfaceExtruder ?? body };
  for (const [role, slot] of Object.entries(slots)) {
    if (!Number.isSafeInteger(slot) || slot < 1 || slot > count) throw new Error(`${role} material requires an existing filament slot (1..${count})`);
  }
  return slots;
}

export async function projectMaterialParts(generated, slots) {
  if (!slots) return generated;
  const { supportSolids, ...result } = generated;
  if (!Array.isArray(supportSolids)) throw new Error('support material provenance is missing');
  const { parts } = await partitionSupportMaterials(supportSolids);
  result.materialParts = parts.map(({ role, triangles }) => ({ role, filament: slots[role],
    triangles: Float32Array.from(triangles.flatMap((p) => p.slice(0, 3))) }));
  validateProjectMaterialParts(result.materialParts, slots, generated.triangles.length > 0);
  return result;
}

export function projectMaterialWarnings(parts, args) {
  const warnings = parts.length ? ['Support bodies, tines and top interfaces use separate material parts. Different materials can reduce tine grip; check bonding and removal before printing.'] : [];
  for (const [role, slot] of [['tine', args.tineExtruder], ['interface', args.interfaceExtruder]]) {
    if (slot != null && !parts.some((p) => p.role === role)) warnings.push(`No ${role} material part was generated for this object.`);
  }
  return warnings;
}
