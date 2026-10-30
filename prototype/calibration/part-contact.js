/** #119 contact comparison: closed procedural shelves, using the shared adapter.
 * deno run -A prototype/calibration/part-contact.js <output-directory>
 * Generated projects are evidence, not checked-in print claims.
 */
import { computeFins } from '../../plugins/shared/engine/fins_entry.js';
import { writeThreeMF } from '../../web/threemf.js';

// A connected C profile, emitted as the exterior of a small rectilinear grid.
// Shared subdivisions keep the corners conforming, without overlapping boxes.
export function shelf() {
  const xs = [-18, -15, 18], zs = [0, 3, 17, 20], t = [];
  const solid = (x, z) => x >= 0 && x < 2 && z >= 0 && z < 3 && (x === 0 || z !== 1);
  const q = (a, b, c, d) => t.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (let x = 0; x < 2; x++) for (let z = 0; z < 3; z++) {
    if (!solid(x, z)) continue;
    const a = xs[x], b = xs[x + 1], lo = zs[z], hi = zs[z + 1];
    q([a,-6,lo],[b,-6,lo],[b,-6,hi],[a,-6,hi]);
    q([b,6,lo],[a,6,lo],[a,6,hi],[b,6,hi]);
    if (!solid(x - 1,z)) q([a,6,lo],[a,-6,lo],[a,-6,hi],[a,6,hi]);
    if (!solid(x + 1,z)) q([b,-6,lo],[b,6,lo],[b,6,hi],[b,-6,hi]);
    if (!solid(x,z - 1)) q([a,6,lo],[b,6,lo],[b,-6,lo],[a,-6,lo]);
    if (!solid(x,z + 1)) q([a,-6,hi],[b,-6,hi],[b,6,hi],[a,6,hi]);
  }
  return Float64Array.from(t);
}
const triples = a => Array.from({length: a.length/3}, (_, i) => Array.from(a.slice(3*i,3*i+3)));

if (import.meta.main) {
  const out = Deno.args[0];
  if (!out) throw new Error('Pass an output directory for the generated coupons.');
  await Deno.mkdir(out, {recursive: true});
  const positions = shelf();
  const manifest = [];
  for (const nozzle of [0.4, 0.8]) for (const name of ['gap-only', 'welded', 'line-anchors']) {
    const options = { nozzle, layerHeight: 0.2, gap: 0.2, bottomGap: name === 'welded' ? 0 : 0.2,
      bottomAnchors: name === 'line-anchors', padStyle: 'off', tines: false };
    const built = computeFins(positions, options);
    if (!built.triangles.length) throw new Error(`No supports for ${name}, nozzle ${nozzle}`);
    const part = triples(positions).map(p => p.map((v,k) => v + built.offset[['x','y','z'][k]]));
    const file = `part-contact-${nozzle}-${name}.3mf`;
    // One object keeps the floating supports at their designed elevation when
    // importing a generic 3MF; a slicer may drop separate objects onto the bed.
    const blob = writeThreeMF(part, triples(built.triangles), file.slice(0,-4));
    await Deno.writeFile(`${out}/${file}`, new Uint8Array(await blob.arrayBuffer()));
    manifest.push({file, options, stats: built.stats});
  }
  await Deno.writeTextFile(`${out}/settings.json`, JSON.stringify(manifest,null,2)+'\n');
}
