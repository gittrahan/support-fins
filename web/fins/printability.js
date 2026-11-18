/**
 * Geometric FDM preflight, after generation. A connected triangle mesh is not a
 * guarantee that its layer sections can print. In particular, a narrow wedge
 * may disappear in a slicer and a higher island may start on nothing.
 *
 * These findings are NOT a toolpath simulation. An ordinary-width circular
 * cross-section must fit, and growth beyond 45 degrees is reported for inspection.
 * Thin-wall/Arachne behaviour, bridging, bead placement/order and adhesion need
 * slicing/printing. Model below a start is only a possible seat, not proof of a
 * safe separation interface. Never use this report alone to certify a print.
 */
import { area, bounds, components, difference, intersection, offset, sectionAt, sectionMesh, union } from './sections.js';

import { checkedContext, layerAt } from './diagnostics.js';
export { layerAt, nominalContext, printabilityStats, validDiagnostics } from './diagnostics.js';

const EPS = 1e-6; // polygon coordinate precision, mm; not a print tolerance
const overlaps = (a, b, margin = 0) => a[0] < b[2] + margin && a[2] > b[0] - margin
  && a[1] < b[3] + margin && a[3] > b[1] - margin;


/**
 * `pieces[].ranges` are [first,end) triangle indices, regardless of soup layout.
 * All positions, including model, share the seated print frame. Results contain
 * only compact locations/parent IDs, never meshes or live polygon-library state.
 * The input is read-only. A budget or invalid contour produces an INCOMPLETE
 * report, with the layer and piece that stopped it; absence of findings is then
 * not evidence that the remaining layers were inspected.
 */
export function supportPrintability(triangles, pieces, model, rawContext) {
  const report = { version: 1, status: 'complete', context: null, layers: 0, starts: [], growth: [], narrow: [] };
  let layer = null, currentPiece = null;
  try {
    const context = report.context = checkedContext(rawContext);
    const indexed = pieces.map((piece) => ({ ...piece, mesh: sectionMesh(triangles, piece.ranges), sections: new Map() }));
    if (!indexed.length) return report;
    let top = 0;
    for (const { mesh } of indexed) top = Math.max(top, mesh.maxZ);
    const last = Math.ceil((top - context.plateZ - context.firstLayerHeight + context.layerHeight / 2) / context.layerHeight);
    if (last > 20000) throw new Error('layer count limit exceeded');
    let part = null, modelSoup = null, previous = [], previousNarrow = [], previousRaw = [];
    const partSection = (z) => {
      if (z < context.plateZ) return [];
      modelSoup ??= typeof model === 'function' ? model() : model ?? [];
      if (!modelSoup.length) return [];
      part ??= sectionMesh(modelSoup);
      return sectionAt(part, z);
    };
    for (let i = 0; i <= Math.max(0, last); i++) {
      layer = layerAt(i, context);
      const next = [], nextNarrow = [], nextRaw = [];
      let modelBelow;
      for (const piece of indexed) {
        currentPiece = piece.id;
        const saved = piece.sections;
        piece.sections = new Map();
        if (piece.mesh.minZ > layer.sliceZ || piece.mesh.maxZ <= layer.sliceZ) continue;
        const paths = sectionAt(piece.mesh, layer.sliceZ);
        for (const region of components(paths)) {
          nextRaw.push({ piece: piece.id, paths: region, bounds: bounds(region) });
          // Vertical sections often repeat for hundreds of layers. Reuse only
          // EXACTLY identical integer paths at the same width from the preceding
          // layer. Still slice every layer and recompute its parent/root/growth
          // relationships. No model-wide or cross-object mesh cache is retained.
          const key = JSON.stringify([layer.width, region]);
          let section = saved.get(key);
          // Equality is printable: an exactly one-line-wide strip has a LINE
          // of centres, not an area. Retain that limiting case within one unit
          // of the polygon grid instead of falsely classifying it as too narrow.
          if (!section) {
            const cores = components(offset(region, -Math.max(0, layer.width / 2 - EPS)));
            section = { bounds: bounds(region), area: area(region), footprints: cores.map((core) => {
              const paths = intersection(offset(core, layer.width / 2), region);
              const size = area(paths);
              if (!paths.length || !(size > 0)) throw new Error('empty ordinary-width footprint');
              return { paths, bounds: bounds(paths), area: size };
            }) };
          }
          piece.sections.set(key, section);
          const location = { piece: piece.id, layer: i, z: layer.z, printZ: layer.printZ, sliceZ: layer.sliceZ, bounds: section.bounds };
          if (!section.footprints.length) {
            nextNarrow.push({ piece: piece.id, paths: region });
            // Report the beginning of a narrow run, not each one of its layers.
            const continued = previousNarrow.some((n) => n.piece === piece.id && area(intersection(n.paths, region)) > 0);
            const held = previous.some((p) => overlaps(location.bounds, p.bounds) && area(intersection(region, p.footprint)) > 0);
            if (!continued && !held) report.narrow.push({ ...location, width: layer.width, area: section.area });
            continue;
          }
          for (const shape of section.footprints) {
            // Reconstruction by a width-sized disk omits slivers which could be
            // dropped by an ordinary wall generator. Keep the original region for
            // diagnostics; never substitute this footprint into exported geometry.
            const footprint = shape.paths, footprintBounds = shape.bounds;
            const parents = previous.filter((p) => footprint === p.footprint
              || overlaps(footprintBounds, p.bounds) && area(intersection(footprint, p.footprint)) > 0);
            const samePiece = parents.some((p) => p.piece === piece.id);
            let root = parents.some((p) => p.root === 'plate' || p.root === 'support') ? 'support'
              : parents.length && parents.every((p) => p.root === 'model-below') ? 'model-below' : 'unresolved';
            if (i === 0 && area(intersection(footprint, sectionAt(piece.mesh, context.plateZ + EPS))) > 0) root = 'plate';
            else if (!parents.length && context.bottomGap > 0) {
              // Use the actual model slice whose extrusion top is below this
              // layer's bottom minus the requested gap. Sampling that TOP as a
              // slice plane misses sloping seats and ignores the first layer.
              const seatIndex = Math.floor((layer.z - layer.height - context.bottomGap
                - context.plateZ - context.firstLayerHeight + EPS) / context.layerHeight);
              modelBelow ??= seatIndex < 0 ? [] : partSection(layerAt(seatIndex, context).sliceZ);
              // Partial overlap is a possible model seat, not a wholly floating
              // start. Neither partial nor full overlap certifies printability;
              // its adequacy and separation still need actual toolpaths.
              if (modelBelow.length && area(intersection(footprint, modelBelow)) > 0) root = 'model-below';
            }
            if (root === 'unresolved' && !parents.length && previousRaw.some((p) => p.piece === piece.id
                && overlaps(footprintBounds, p.bounds) && area(intersection(footprint, p.paths)) > 0)) {
              // The ordinary-width footprint has just appeared on an existing
              // narrow part of this support. Keep the transition in the report,
              // but don't count it again as a new floating start. Narrow-run
              // findings remain counted; this does NOT establish a printable
              // parent or let a later child inherit a certified support root.
              root = 'narrow-below';
            }
            if (!samePiece) report.starts.push({ ...location, bounds: footprintBounds, root,
              parents: [...new Set(parents.map((p) => p.piece))], area: shape.area });
            // An identical previous footprint is wholly contained by its own
            // positive offset; it cannot contribute a growth finding.
            if (parents.length && !parents.some((p) => p.footprint === footprint)) {
              // Only sections within this layer's growth distance can reach the
              // footprint. Avoid unioning distant, disconnected fins into one
              // large coordinate range, which needlessly invokes big integers.
              // 45 degrees is a geometric inspection limit, not a slicing rule.
              const nearby = previous.filter((p) => overlaps(footprintBounds, p.bounds, layer.height + EPS));
              const grown = offset(union(nearby.flatMap((p) => p.footprint)), layer.height);
              const unsupported = difference(footprint, grown);
              if (unsupported.length) report.growth.push({ ...location, bounds: bounds(unsupported), area: area(unsupported) });
            }
            next.push({ piece: piece.id, footprint, bounds: footprintBounds, root });
          }
        }
      }
      previous = next; previousNarrow = nextNarrow; previousRaw = nextRaw;
      report.layers++;
      if (report.starts.length + report.growth.length + report.narrow.length > 50000) throw new Error('finding count limit exceeded');
    }
  } catch (error) {
    report.status = report.context ? 'incomplete' : 'unavailable';
    report.stopped = { piece: currentPiece, layer: layer?.index ?? null, reason: error.message };
  }
  return report;
}
