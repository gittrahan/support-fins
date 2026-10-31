// Object-scoped conversion for sequential project export. The caller keeps its
// painted export parts separate from the existing support-analysis geometry.
import { cutNegatives } from '../../web/cut.js';
import { subtractProjectNegatives } from './project-analysis.js';
import { remapProjectPaint } from './project-paint.js';
import { canonicalCutMesh } from './project-bake-mesh.js';

function settings(component, filamentCount) {
  if (component.settings.length > 1) throw new Error('ambiguous part settings on converted component');
  for (const pairs of [component.objectSettings, component.settings[0]?.metadata ?? []]) {
    const seen = new Set();
    for (const [key, value] of pairs) {
      if (seen.has(key)) throw new Error(`duplicate setting on converted part: ${key}`);
      seen.add(key);
      if (
        /^(extruder|wall_filament|sparse_infill_filament|solid_infill_filament)$/.test(key) &&
        (!/^\d+$/.test(value) || Number(value) > filamentCount)
      ) {
        throw new Error(`unavailable filament assignment on converted part: ${key}`);
      }
    }
  }
}

/** Return export meshes separately from the existing analysis representation.
 * Nothing is written, no original mesh is modified, and failed conversion has
 * no partial result. The caller releases this object's decoded tree afterwards.
 * New cut surfaces inherit their owning part's material settings. Surviving
 * painting is retained, but the slicer can propagate it differently after cuts
 * are baked. Callers must report the returned warnings for this object; success
 * does not certify identical sliced material regions.
 * `cut` is a test seam for errors, never a user-selectable boolean algorithm. */
export async function bakeProjectNegatives(model, expected, { filamentCount, cut = cutNegatives } = {}) {
  if (!Number.isSafeInteger(filamentCount) || filamentCount < 1) {
    throw new Error('project filament count is required for paint conversion');
  }
  if (!expected || !model.components) throw new Error('negative conversion requires component provenance');
  const analysisPositions = await subtractProjectNegatives(model, expected, cut);
  const extras = model.extras.filter((e) => e.kind === 'negative');
  const parts = [], removed = [];
  for (const component of model.components.filter((c) => c.kind === 'model')) {
    if (!component.positions.length) throw new Error('empty printable component in conversion');
    settings(component, filamentCount);
    const result = await cut({ positions: component.positions, extras }, { provenance: true });
    if (result.why === 'whole') {
      // The aggregate check already validated every cutter. Entirely removed
      // components are legitimate, but the complete object must still exist.
      removed.push({ path: component.path, objectId: component.objectId, route: [...component.route] });
      continue;
    }
    if (result.why || result.cut !== expected || result.uncut !== 0) {
      throw new Error(`component subtraction failed: ${result.why ?? 'incomplete subtraction'}`);
    }
    if (
      !result.positions?.length || result.positions.length % 9 || !result.positions.every(Number.isFinite)
    ) {
      throw new Error('component subtraction produced invalid geometry');
    }
    const canonical = canonicalCutMesh(result);
    const converted = remapProjectPaint(component, canonical, filamentCount);
    // Paint-boundary welding must not join otherwise separate shells at a
    // vertex. Edge counts alone cannot detect that invalid topology.
    const unchanged = converted.positions.length === canonical.positions.length &&
      converted.positions.every((v, i) => v === canonical.positions[i]);
    if (!unchanged && canonicalCutMesh(converted).positions !== converted.positions) {
      throw new Error('paint remapping left degenerate geometry');
    }
    const materialIDs = new Set(
      [component.source.attributes.pid, ...converted.triangleAttributes.map((a) => a.pid)].filter((id) =>
        id !== undefined
      ),
    );
    parts.push({
      ...converted,
      collapsedFaces: canonical.collapsedFaces,
      source: {
        path: component.path,
        objectId: component.objectId,
        partId: component.partId,
        route: [...component.route],
      },
      objectAttributes: { ...component.source.attributes },
      properties: structuredClone(
        component.source.properties.filter((r) => materialIDs.has(r.attributes.id)),
      ),
      modelAttributes: { ...component.source.modelAttributes },
      settings: structuredClone(component.settings[0] ?? null),
    });
  }
  if (!parts.length) throw new Error('negative conversion removed the entire object');
  return {
    analysisPositions, parts, removed,
    materialPolicy: 'base-material-on-cuts',
    warnings: [
      'Negative parts were baked. New cut surfaces inherit each part\'s material settings. '
      + 'Sliced colors and material regions may differ from the original project; '
      + 'inspect the sliced preview and manually correct painting or material assignments if needed.',
    ],
  };
}
