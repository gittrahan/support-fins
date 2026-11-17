/** Procedural native-slicer control: a tilted cube, flat pedestal and level ledge.
 * deno run -A prototype/material-parts/generate.js --out /existing/temporary/directory
 * No printer profiles or private meshes. Assign filaments and save in the slicer.
 */
import {
  analyze,
  block,
  buildTopology,
  fins,
  rotX,
} from "../../tests/_util.js";
import { partitionSupportMaterials } from "../../web/support-materials.js";
import { writePlate3MF } from "../../web/threemf.js";
const arg = Deno.args.indexOf("--out");
if (arg < 0 || !Deno.args[arg + 1]) throw new Error("--out directory required");
const out = await Deno.realPath(Deno.args[arg + 1]);
const soup = (p) =>
  Array.from(
    { length: p.length / 3 },
    (_, i) => Array.from(p.slice(3 * i, 3 * i + 3)),
  );
const rot = rotX(35),
  cube = soup(block(-12, 12, -12, 12, 0, 24)).map((
    [x, y, z],
  ) => [x, rot[4] * y + rot[7] * z, rot[5] * y + rot[8] * z]);
const zmin = Math.min(...cube.map((p) => p[2]));
for (const p of cube) p[2] -= zmin;
const body = [];
for (const tris of [cube, soup(block(-14, 14, -14, 14, 0, 2)), soup(block(8, 30, -8, 8, 20, 24))]) {
  const rec = { role: "body" };
  body.push(...tris.map((p) => [...p, 0, rec]));
}
const shape = (await partitionSupportMaterials(body)).parts[0].triangles;
const positions = Float32Array.from(shape.flat());
const topo = buildTopology({ getAttribute: () => ({ array: positions }) }),
  identity = rotX(0),
  result = analyze(topo, 45, identity);
const built = fins.buildFins(topo, result, identity, {
  mode: "auto",
  coverage: 1,
  tines: true,
  bedPad: false,
  tunables: {
    iface: "all",
    separateTines: true,
    tineDir: "horizontal",
    nozzle: .4,
  },
});
const parts = (await partitionSupportMaterials(built.triangles)).parts;
if (parts.length !== 3) {
  throw new Error("control must contain body, tines and top interfaces");
}
const partTris = shape.map(
  (p) => [
    p[0] + result.offset.x,
    p[1] + result.offset.y,
    p[2] + result.offset.z,
  ],
);
for (const materialFormat of ["components", "prusa2"]) {
  const blob = await writePlate3MF([{
    name: "rooted-cube",
    partTris,
    finTris: [],
    materialParts: parts,
    materialFormat,
  }], { separate: true });
  await Deno.writeFile(
    `${out}/material-parts-${materialFormat}.3mf`,
    new Uint8Array(await blob.arrayBuffer()),
  );
}
const control = await writePlate3MF([{
  name: "rooted-cube",
  partTris,
  finTris: built.triangles,
}], { separate: true });
await Deno.writeFile(
  `${out}/material-parts-control.3mf`,
  new Uint8Array(await control.arrayBuffer()),
);
console.log(
  "Wrote the unsplit control and both material-part formats. Use 0.4 mm nozzle / 0.20 mm layers.",
);
