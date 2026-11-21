/** Validate completed project material records, both fresh and resumed. */
export function validateProjectMaterialParts(parts, slots, nonempty, matching = null) {
  if (!Array.isArray(parts) || (nonempty && !parts.length) || (!nonempty && parts.length)) throw new Error('incomplete support material checkpoint');
  if (matching && (matching.version !== 1 || !Number.isSafeInteger(matching.fallback) || matching.fallback < 1
    || !Array.isArray(matching.diagnostics) || matching.diagnostics.some((d) => !['tine', 'interface'].includes(d.role)
      || d.code !== 'unresolved-contact-material' || !Number.isFinite(d.volume) || d.volume <= 0))) throw new Error('invalid matched contact checkpoint');
  if (slots && !!slots.match !== !!matching) throw new Error('incomplete matched contact checkpoint');
  if (slots?.match && slots.fallback !== matching.fallback) throw new Error('changed contact fallback');
  const seen = new Set();
  for (const part of parts) {
    const key = matching ? `${part?.role}:${part?.filament}` : part?.role;
    if (!part || !['body', 'tine', 'interface'].includes(part.role) || seen.has(key)
      || !Number.isSafeInteger(part.filament) || part.filament < 1
      || slots && (slots.match ? part.filament > slots.count || part.role === 'body' && part.filament !== slots.body : slots[part.role] !== part.filament)
      || !(part.triangles instanceof Float32Array)
      || !part.triangles.length || part.triangles.length % 9 || !part.triangles.every(Number.isFinite)) {
      throw new Error('invalid support material part');
    }
    seen.add(key);
  }
}
