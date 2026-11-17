// Shared procedural native control. Imports helpers only, never test modules.
import { block, rotX } from '../../tests/_util.js';
import { partitionSupportMaterials } from '../../web/support-materials.js';
export async function rootedMaterialFixture() {
  const soup = (p) =>
    Array.from({ length: p.length / 3 }, (_, i) => Array.from(p.slice(3 * i, 3 * i + 3)));
  const rot = rotX(35),
    cube = soup(block(-12, 12, -12, 12, 0, 24)).map((
      [x, y, z],
    ) => [x, rot[4] * y + rot[7] * z, rot[5] * y + rot[8] * z]);
  const zmin = Math.min(...cube.map((p) => p[2]));
  for (const p of cube) p[2] -= zmin;
  const body = [];
  for (const tris of [cube, soup(block(-14, 14, -14, 14, 0, 2)), soup(block(8, 30, -8, 8, 20, 24))]) {
    const rec = { role: 'body' };
    body.push(...tris.map((p) => [...p, 0, rec]));
  }
  return (await partitionSupportMaterials(body)).parts[0].triangles;
}
