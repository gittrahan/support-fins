/** Validate completed project material records, both fresh and resumed. */
export function validateProjectMaterialParts(parts, slots, nonempty) {
  if (!Array.isArray(parts) || (nonempty && !parts.length) || (!nonempty && parts.length)) throw new Error('incomplete support material checkpoint');
  const seen = new Set();
  for (const part of parts) {
    if (!part || !['body', 'tine', 'interface'].includes(part.role) || seen.has(part.role)
      || !Number.isSafeInteger(part.filament) || part.filament < 1
      || slots && slots[part.role] !== part.filament || !(part.triangles instanceof Float32Array)
      || !part.triangles.length || part.triangles.length % 9 || !part.triangles.every(Number.isFinite)) {
      throw new Error('invalid support material part');
    }
    seen.add(part.role);
  }
}
