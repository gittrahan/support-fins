// Project-only role assignments. Source palettes and models remain untouched.
import { partitionSupportMaterials } from '../../web/support-materials.js';
import { matchContactMaterials } from '../../web/contact-materials.js';
import { validateProjectMaterialParts } from './project-material-records.js';
export { validateProjectMaterialParts } from './project-material-records.js';

export const roleMaterialsRequested = (args) => args.matchContactMaterials || args.tineExtruder != null || args.interfaceExtruder != null;

export function projectMaterialSlots(settings, args, body) {
  if (!roleMaterialsRequested(args)) return null;
  const count = Array.isArray(settings.filament_colour) ? settings.filament_colour.length : 0;
  const slots = { body, tine: args.tineExtruder ?? body, interface: args.interfaceExtruder ?? body };
  for (const [role, slot] of Object.entries(slots)) {
    if (!Number.isSafeInteger(slot) || slot < 1 || slot > count) throw new Error(`${role} material requires an existing filament slot (1..${count})`);
  }
  if (args.matchContactMaterials) {
    const fallback = args.contactFallbackExtruder;
    if (!Number.isSafeInteger(fallback) || fallback < 1 || fallback > count) throw new Error(`contact fallback requires an existing filament slot (1..${count})`);
    Object.assign(slots, { match: true, fallback, count });
  }
  return slots;
}

export async function projectMaterialParts(generated, slots, sourceRegions = null) {
  if (!slots) return generated;
  const { supportSolids, ...result } = generated;
  if (!Array.isArray(supportSolids)) throw new Error('support material provenance is missing');
  if (slots.match) {
    if (!Array.isArray(sourceRegions)) throw new Error('contact source regions are missing');
    const shift = [generated.offset.x, generated.offset.y, generated.offset.z];
    const { parts, diagnostics } = await matchContactMaterials(supportSolids, {
      regions: sourceRegions.map((r) => ({ ...r, triangle: r.triangle.map((p) => p.map((v, k) => v + shift[k])) })),
      bodyMaterial: `filament:${slots.body}`, fallbackMaterial: `filament:${slots.fallback}`,
    });
    result.materialParts = parts.map(({ role, material, triangles }) => ({ role, filament: /^filament:[1-9]\d*$/.test(material) ? +material.slice(9) : NaN,
      triangles: Float32Array.from(triangles.flatMap((p) => p.slice(0, 3))) }));
    result.contactMaterials = { version: 1, fallback: slots.fallback, diagnostics };
  } else {
    const { parts } = await partitionSupportMaterials(supportSolids);
    result.materialParts = parts.map(({ role, triangles }) => ({ role, filament: slots[role],
      triangles: Float32Array.from(triangles.flatMap((p) => p.slice(0, 3))) }));
  }
  validateProjectMaterialParts(result.materialParts, slots, generated.triangles.length > 0, result.contactMaterials);
  return result;
}

export function projectMaterialWarnings(parts, args, matching) {
  const warnings = parts.length ? ['Support bodies, tines and top interfaces use separate material parts. Different materials can reduce tine grip; check bonding and removal before printing.'] : [];
  for (const [role, slot] of [['tine', args.tineExtruder], ['interface', args.interfaceExtruder]]) {
    if (slot != null && !parts.some((p) => p.role === role)) warnings.push(`No ${role} material part was generated for this object.`);
  }
  if (matching?.diagnostics.length) warnings.push(`Some contact regions have unresolved or ambiguous source materials; those regions use fallback filament ${matching.fallback}. Inspect their assignments in the slicer.`);
  return warnings;
}
