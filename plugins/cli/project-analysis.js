// Analysis only: these meshes never replace the project's original ZIP members.
import { cutNegatives } from '../../web/cut.js';
import { readThreeMFParts, scanXML } from '../../web/threemf.js';
import { child, children, attr } from './project-xml.js';

const ROOT = '3D/3dmodel.model', CONFIG = 'Metadata/model_settings.config';

/** Count occurrences, not IDs: a cutter component may be instanced twice. The
 * reader omits empty extras, so compare this count with the decoded geometry. */
export function negativeComponents(object, config) {
  const parts = children(config, 'part');
  const negatives = parts.filter((p) => p.attrs.subtype === 'negative_part');
  if (!negatives.length) return 0;
  const ids = new Set();
  const components = children(child(object, 'components'), 'component');
  for (const part of negatives) {
    const id = part.attrs.id;
    if (!id || parts.filter((p) => p.attrs.id === id).length !== 1) {
      throw new Error('negative parts have missing or ambiguous part IDs');
    }
    if (!components.some((c) => c.attrs.objectid === id)) {
      throw new Error(`negative part ${id} has no component`);
    }
    ids.add(id);
  }
  const count = components.filter((c) => ids.has(c.attrs.objectid)).length;
  if (count === components.length) throw new Error('negative parts leave no printable body components');
  return count;
}

/** Strict project policy; the ordinary CLI/browser keep their existing fallback.
 * `cut` is a private test seam for failures that must never reach generation. */
export async function subtractProjectNegatives(model, expected, cut = cutNegatives) {
  const negatives = model.extras.filter((e) => e.kind === 'negative');
  if (negatives.length !== expected) {
    throw new Error(`negative parts: expected ${expected} cutter components, decoded ${negatives.length}; missing or empty cutter geometry`);
  }
  if (!expected) return model.positions; // retain precision and geometry verbatim
  let result;
  try {
    // Paint need not be remapped onto temporary cut faces: the original painted
    // meshes and negative volumes are preserved in the output, unchanged.
    result = await cut({ positions: model.positions, extras: negatives });
  } catch (e) {
    throw new Error(`negative parts could not be subtracted: ${e.message}`);
  }
  const why = {
    open: 'the printable mesh is not a closed solid',
    whole: 'the cutters remove the entire printable mesh',
    load: 'the subtraction engine could not load',
  };
  if (result.why) throw new Error(`negative parts could not be subtracted: ${why[result.why] ?? result.why}`);
  if (result.uncut !== 0 || result.cut !== expected) {
    throw new Error(`negative parts were not fully subtracted (${result.cut}/${expected} cutters); no fins generated for this object`);
  }
  if (!result.positions?.length || result.positions.length % 9 || !result.positions.every(Number.isFinite)) {
    throw new Error('negative parts produced empty or invalid analysis geometry');
  }
  return result.positions;
}

function partPath(path) {
  const name = path.replace(/^\//, '');
  if (!name || name.includes('\\') || /[:?#%]/.test(name)
      || name.split('/').some((p) => !p || p === '..' || p === '.')) throw new Error(`unsupported model path: ${path}`);
  return name;
}

/** Load one selected dependency tree. Returning only positions allows decoded
 * members, paint and cutters to be collected before fin generation/next object. */
export async function projectPositions(zip, rootBytes, configBytes, plan) {
  const members = new Map([[ROOT, rootBytes], [CONFIG, configBytes]]);
  const visiting = new Set(), visited = new Set();
  const load = async (name) => {
    if (visiting.has(name)) throw new Error('cyclic model-part references');
    if (visited.has(name)) return;
    visiting.add(name);
    if (!members.has(name)) members.set(name, await zip.read(name));
    const paths = new Set();
    scanXML(new TextDecoder().decode(members.get(name)), (tag, attrs) => {
      if (tag.split(':').pop() === 'model' && attrs.unit && attrs.unit !== 'millimeter') {
        throw new Error(`project mode requires millimeter units in ${name}`);
      }
      if (tag.split(':').pop() === 'component') {
        const path = Object.entries(attrs).find(([k]) => k.split(':').pop() === 'path')?.[1];
        if (path) paths.add(partPath(path));
      }
    }, () => {});
    for (const path of paths) await load(path);
    visiting.delete(name); visited.add(name);
  };
  for (const component of children(child(plan.object, 'components'), 'component')) {
    const path = attr(component, 'path');
    if (!path) throw new Error('inline component meshes are not yet supported in project mode');
    await load(partPath(path));
  }
  const model = readThreeMFParts(members, { buildIndex: plan.number - 1, doublePrecision: true, outwardWinding: true }).objects[0];
  members.clear();
  return subtractProjectNegatives(model, plan.negativeCount);
}
