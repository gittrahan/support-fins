/** Advisory export preflight, not a slicer simulation. A browser export has no
 * resolved extrusion profile: the selected nozzle is only a width proxy, and
 * the selected layer height assumes equal first/subsequent layers. Arachne,
 * thin-wall processing, actual widths and layer schedules can change the result.
 * Never alter or omit material geometry in response to a finding. */
import { components, offset, sectionAt, sectionMesh } from './fins/sections.js';

export function supportMaterialWarnings(parts, { nozzle, layerHeight } = {}) {
  const tines = parts.filter(p => p.role === 'tine');
  if (!tines.length) return { status: 'complete', narrowTines: false };
  try {
    if (!(Number.isFinite(nozzle) && nozzle > 0 && Number.isFinite(layerHeight) && layerHeight > 0 && layerHeight <= nozzle)) {
      throw new Error('nozzle/layer settings unavailable');
    }
    for (const tine of tines) {
      const mesh = sectionMesh(tine.triangles), last = Math.ceil(mesh.maxZ / layerHeight);
      if (last > 20000 || tine.triangles.length > 3000000) throw new Error('tine inspection limit exceeded');
      let sampled = false;
      for (let i = Math.max(0, Math.ceil(mesh.minZ / layerHeight - .5)); i < last; i++) {
        const sliceZ = (i + .5) * layerHeight;
        for (const region of components(sectionAt(mesh, sliceZ))) {
          sampled = true;
          if (!offset(region, -Math.max(0, nozzle / 2 - 1e-6)).length) {
            return { status: 'complete', narrowTines: true, sliceZ, widthProxy: nozzle };
          }
        }
      }
      // A short tine can fall entirely between the selected layer planes.
      if (!sampled) return { status: 'complete', narrowTines: true, widthProxy: nozzle };
    }
    return { status: 'complete', narrowTines: false, widthProxy: nozzle };
  } catch (error) {
    return { status: 'incomplete', reason: error.message };
  }
}
