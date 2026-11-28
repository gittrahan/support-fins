// What an export slot does, with SolidCraft reached only through `host` (quickjs.js makes
// it of the component's craft:plugin calls; tests/export.test.js passes a stand-in), so the
// whole path runs in a test without SolidCraft.
//
// It reads the design's visible bodies through `model.mesh`, runs the website's engine
// on them (plugins/shared/engine, web/*.js, unmodified) and returns the file the command
// line writes for the same part (plugins/cli/cli.js finFile): the part posed, centred
// over the plate origin and seated on z = 0, with its fins -- or, with Fins only, the
// fins alone, lined up with the part where it is in the design.
import { computeFins, optionsFromDialog, OPTIONS_SCHEMA } from '../../shared/engine/fins_entry.js';
import { reportLine } from '../../shared/engine/report.js';
import { writeBinarySTL } from '../../../web/stl.js';
import { writeThreeMF } from '../../../web/threemf.js';
import { FIELD_OF_KEY, PERCENT_KEYS } from './fields.js';

// model.mesh reads at most 16384 triangles a body (its reply is at most 1 MiB of JSON).
// A body over that is read again at a coarser chord, from SolidCraft's default up.
export const TOLERANCES = [0.05, 0.1, 0.2, 0.5, 1, 2];

/** A WIT plugin-error, thrown: componentize-js returns a thrown `payload` as the err. */
export class PluginError extends Error {
  constructor(tag, val) {
    super(typeof val === 'string' ? val : val?.reason ?? tag);
    this.payload = val === undefined ? { tag } : { tag, val };
  }
}
const invalid = (field, reason) => new PluginError('invalid-input', { field, reason });
const unsupported = (reason) => new PluginError('unsupported', reason);

// A refused host call throws an error whose payload is the WIT plugin-error.
const reasonOf = (e) => {
  const v = e?.payload?.val;
  return typeof v === 'string' ? v : v?.reason ?? e?.payload?.tag ?? String(e?.message ?? e);
};

/** The slot form's values -> what to fin and how. Field names: fields.js. */
export function readOptions(json, slot) {
  let values;
  try {
    values = json ? JSON.parse(json) : {};
  } catch (e) {
    throw invalid('options', `not JSON: ${e.message}`);
  }
  const dialog = {};
  for (const o of OPTIONS_SCHEMA.options) {
    const field = FIELD_OF_KEY[o.key];
    if (!Object.hasOwn(values, field)) continue;
    const v = values[field];
    dialog[o.key] = PERCENT_KEYS.has(o.key) && typeof v === 'number' ? v / 100 : v;
  }
  let engine;
  try {
    engine = optionsFromDialog(dialog);
  } catch (e) {
    throw invalid('options', e.message);
  }
  const angle = (k) => {
    const v = values[k] ?? 0;
    if (typeof v !== 'number' || !Number.isFinite(v)) throw invalid(k, 'must be a number of degrees');
    return v;
  };
  const rot = [angle('rot-x'), angle('rot-y'), angle('rot-z')];
  const finsOnly = values['fins-only'] === true;
  if (finsOnly && slot !== 'export-stl') throw invalid('fins-only', 'the fins alone are written as an STL');
  // the fins line up with the part where it is in the design, so they can't be turned
  if (finsOnly && rot.some((a) => a !== 0)) throw invalid('fins-only', 'Fins only takes no rotation');
  const bodies = values.bodies ?? [];
  if (!Array.isArray(bodies) || bodies.some((b) => typeof b !== 'string')) {
    throw invalid('bodies', 'must be a list of body names');
  }
  return { engine, rot, bodies, finsOnly };
}

/** The design's name and the visible bodies to fin, by name, in the design's order. */
function partOf(host, only) {
  const doc = JSON.parse(host.run('document.inspect', '{}'));
  const visible = (doc.bodies || []).filter((b) => b.visible !== false).map((b) => b.name);
  const missing = only.filter((n) => !visible.includes(n));
  if (missing.length) {
    throw invalid('bodies', `no visible body ${missing.map((n) => JSON.stringify(n)).join(', ')}; `
      + `the design has ${visible.map((n) => JSON.stringify(n)).join(', ') || 'none'}`);
  }
  const names = only.length ? only : visible;
  if (!names.length) throw unsupported('the design has no visible body to fin');
  const titled = doc.name && doc.name !== 'Untitled' ? doc.name : null;
  return { names, title: titled ?? (names.length === 1 ? names[0] : 'Part') };
}

/** One body's triangles, read at the finest chord a plugin's transfer budget allows. */
function bodyMesh(host, body) {
  let last;
  for (const tolerance of TOLERANCES) {
    try {
      return { ...JSON.parse(host.run('model.mesh', JSON.stringify({ body, tolerance }))), tolerance };
    } catch (e) {
      last = reasonOf(e);
      if (!/transfer budget/.test(last)) throw e;
    }
  }
  throw unsupported(`${body} has more triangles than a plugin can read, even at a `
    + `${TOLERANCES.at(-1)} mm chord (${last})`);
}

/**
 * Column-major 3x3 for the site's rotation readout: "X a · Y b · Z c" is three.js
 * Euler(a, b, c, 'XYZ'). The command line's rotationMatrix (plugins/cli/cli.js), which
 * tests/export.test.js holds this to.
 */
export function rotationMatrix([ax, ay, az]) {
  const r = (d) => (d * Math.PI) / 180;
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(r(ax)), Math.sin(r(ax)), Math.cos(r(ay)),
    Math.sin(r(ay)), Math.cos(r(az)), Math.sin(r(az))];
  return [
    cy * cz, cx * sz + sx * sy * cz, sx * sz - cx * sy * cz,
    -cy * sz, cx * cz - sx * sy * sz, sx * cz + cx * sy * sz,
    sy, -sx * cy, cx * cy,
  ];
}

// A placement, as component.list gives it: a 4x4 by column, [x axis, y axis, z axis,
// origin], each [x, y, z, w], within the component it is placed in.
const IDENTITY = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];

function compose(a, b) {   // a * b, both by column
  return b.map((col) => [0, 1, 2, 3].map((r) => a[0][r] * col[0] + a[1][r] * col[1] + a[2][r] * col[2] + a[3][r] * col[3]));
}

/**
 * Where component `id` stands in the design: one world transform for each of its
 * placements (a component placed twice is two copies of its bodies), through every
 * component it is placed in. The design's own component (0) is the world.
 */
export function placementsOf(components, id, seen = new Set()) {
  if (id === 0) return [IDENTITY];
  if (seen.has(id)) return [];   // a component can't hold itself; don't loop if the list says so
  const c = components.find((k) => k.id === id);
  const out = [];
  for (const o of c?.occurrences ?? []) {
    for (const parent of placementsOf(components, o.parent, new Set([...seen, id]))) out.push(compose(parent, o.transform));
  }
  return out;
}

/**
 * Indexed meshes -> one float64 soup, 9 numbers a triangle: each mesh at each of its
 * `places` (world transforms, by column), then turned by `rot`, the site's readout.
 */
export function posedSoup(meshes, rot = [0, 0, 0]) {
  const n = meshes.reduce((s, m) => s + m.triangles.length * (m.places ?? [IDENTITY]).length, 0);
  const out = new Float64Array(n * 9);
  const r = rotationMatrix(rot);
  let o = 0;
  for (const mesh of meshes) {
    for (const t of mesh.places ?? [IDENTITY]) {
      // world = rot * (t * local): one 3x4 for the two
      // (r is three.js's column-major 3x3: r[3 * col + row]; the origin, m[3], turns too)
      const m = [0, 1, 2, 3].map((c) => [0, 1, 2].map((row) => r[row] * t[c][0] + r[3 + row] * t[c][1] + r[6 + row] * t[c][2]));
      const p = mesh.positions;
      for (const tri of mesh.triangles) {
        for (const i of tri) {
          const [x, y, z] = p[i];
          out[o++] = m[0][0] * x + m[1][0] * y + m[2][0] * z + m[3][0];
          out[o++] = m[0][1] * x + m[1][1] * y + m[2][1] * z + m[3][1];
          out[o++] = m[0][2] * x + m[1][2] * y + m[2][2] * z + m[3][2];
        }
      }
    }
  }
  return out;
}

const triples = (flat, add = [0, 0, 0]) => {
  const out = new Array(flat.length / 3);
  for (let i = 0, j = 0; i < flat.length; i += 3, j++) {
    out[j] = [flat[i] + add[0], flat[i + 1] + add[1], flat[i + 2] + add[2]];
  }
  return out;
};

/**
 * Export the open design through `slot` ('export-3mf' or 'export-stl').
 * @param host  { run(command, json) -> json, log(level, message), progress(fraction, message) }
 * @returns Promise<Uint8Array>  the file's bytes
 */
export async function exportFile(host, slot, optionsJson) {
  if (slot !== 'export-3mf' && slot !== 'export-stl') throw unsupported(`no export slot ${slot}`);
  const { engine, rot, bodies, finsOnly } = readOptions(optionsJson, slot);
  const { names, title } = partOf(host, bodies);
  host.progress(0.05, 'Reading the part');
  const meshes = names.map((b) => bodyMesh(host, b));
  // model.mesh reads a body where it is in its own component (an inserted STL has one):
  // place it as the design does, every time it is placed
  if (meshes.some((m) => m.component !== 0)) {
    const { components = [] } = JSON.parse(host.run('component.list', '{}'));
    for (const m of meshes) {
      m.places = placementsOf(components, m.component);
      if (!m.places.length) throw unsupported(`${m.body} is in a component that isn't placed in the design`);
    }
  }
  for (const m of meshes) {
    if (m.tolerance > TOLERANCES[0]) {
      host.log('warn', `${m.body} read at a ${m.tolerance} mm chord: the finest a plugin can read it at`);
    }
  }
  const posed = posedSoup(meshes, rot);
  host.progress(0.15, 'Building fins');
  const { triangles, offset, stats } = computeFins(posed, engine);
  const report = reportLine(stats);
  host.log('info', report);
  host.progress(0.9, 'Writing the file');
  // The fins come back in the engine's seated frame: the part moves to them (the site's
  // export frame), or with Fins only they move back onto the part (fin - offset).
  const at = [offset.x, offset.y, offset.z];
  let blob;
  if (finsOnly) {
    if (triangles.length === 0) throw unsupported(`${report}: no fins to write`);
    blob = writeBinarySTL(triples(triangles, [-offset.x, -offset.y, -offset.z]), `${title} fins`);
  } else if (slot === 'export-3mf') {
    blob = await writeThreeMF(triples(posed, at), triples(triangles), title);
  } else {
    blob = writeBinarySTL([...triples(posed, at), ...triples(triangles)], title);
  }
  return new Uint8Array(await blob.arrayBuffer());
}
