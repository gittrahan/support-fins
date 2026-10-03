// The site's build, exactly as the app calls it (ui/pose.js + ui/part.js + ui/finbuild.js
// finOpts + ui/walls.js), for tests that compare builds: golden.test.js pins the output,
// stability.test.js nudges the pose. Split out so importing `run` doesn't re-register the
// golden tests.

import { analyze, loadModel, fins } from './_util.js';
import * as THREE from '../web/vendor/three/three.core.js';

const { buildFins } = fins;
const { drawnWall } = await import('../web/draw.js');
const { MATERIAL } = await import('../web/materials.js');

/** The site's tunables for a material, the form otherwise untouched (finOpts). */
function tunables(material) {
  const m = MATERIAL[material];
  return { padH: m.padH, padGrab: m.padGrab, propGap: m.propGap,
           padStyle: 'auto',                                     // Bed pad: Auto
           padCustom: { h: 0.5, gap: 0.0, grip: 0.05, margin: 4.0 }, // fins/pad.js PAD.custom
           cutout: 'none' };
}

/** finOpts() with the form untouched, for a material and fin mode. */
export function siteOpts({ material = 'pla', mode = 'auto', sway = false } = {}) {
  const t = tunables(material);
  return {
    mode, bedPad: true, tines: true, tineDensity: 0, layerHeight: 0.2, coverage: 0.5,
    // swayOpts() with its fields at the form's defaults
    sway: sway ? { on: true, gripFrom: 0, tineSpacing: 6, reach: 0.15, gap: t.propGap,
                   tines: true, layerHeight: 0.2 } : undefined,
    tunables: t,
  };
}

/** The rotate ring's pose for the readout [x, y, z]: snapped turns about the world
 *  axes (TransformControls premultiplies), as Matrix3 elements like part.js rotM3. */
const SNAP = THREE.MathUtils.degToRad(5);
export function sitePose(deg, eps = 0) {
  const q = new THREE.Quaternion();
  const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
  deg.forEach((d, i) => {
    if (d) q.premultiply(new THREE.Quaternion().setFromAxisAngle(axes[i], Math.round(d / 5) * SNAP + eps));
  });
  // `eps` nudges every turn by that many rad (stability.test.js); an unturned pose
  // takes it about X
  if (eps && !deg.some(Boolean)) q.premultiply(new THREE.Quaternion().setFromAxisAngle(axes[0], eps));
  return new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(q)).elements;
}

export const r3 = (x) => Math.round(x * 1000) / 1000;

/** Seat the part as ui/walls.js partPrintTriangles does. */
function seated(topo, rot, o) {
  const { pos, nFaces } = topo;
  const a = new Float64Array(nFaces * 9);
  for (let i = 0; i < a.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    a[i] = rot[0] * x + rot[3] * y + rot[6] * z + o.x;
    a[i + 1] = rot[1] * x + rot[4] * y + rot[7] * z + o.y;
    a[i + 2] = rot[2] * x + rot[5] * y + rot[8] * z + o.z;
  }
  return a;
}

export function run(scene, rot = sitePose(scene.rot)) {
  const topo = loadModel(scene.model);
  const res = analyze(topo, 45, rot);
  if (scene.draw) {
    // Draw: the site still builds in 'prop' mode for the bed pad it exports
    // (finbuild.js), then sweeps each drawn wall (walls.js rebuildDrawn).
    const opts = siteOpts({ ...scene.set, mode: 'prop' });
    const b = buildFins(topo, res, rot, opts);
    const r = drawnWall(scene.draw[0], scene.draw[1], seated(topo, rot, res.offset), 0,
      { tines: opts.tines, tineDensity: opts.tineDensity, layerHeight: opts.layerHeight,
        topo, rot, offset: res.offset });
    return { tris: r.ok ? r.tris : [], pad: b.padTriangles ?? [], walls: r.ok ? 1 : 0,
             tines: r.tines ?? 0, unserved: 0,
             summary: r.ok ? [{ height: r.height, length: r.length }] : [{ refused: r.reason }] };
  }
  const b = buildFins(topo, res, rot, siteOpts(scene.set));
  return {
    tris: b.triangles, pad: b.padTriangles ?? [],
    walls: (b.braceCount ?? 0) + (b.propCount ?? 0), tines: b.tines, unserved: b.unserved ?? 0,
    // where each wall runs, so a golden diff shows a wall that moved, not just a hash
    summary: (b.fins ?? []).map((f) => ({ kind: f.kind, height: f.height, length: f.length,
                                         tines: f.tines,
                                         from: f.line?.[0]?.map(r3), to: f.line?.at(-1)?.map(r3) })),
  };
}
