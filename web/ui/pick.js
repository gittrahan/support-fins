/**
 * Fast pointer picks: every three.js Mesh raycast goes through three-mesh-bvh
 * (vendored unmodified in web/vendor/three-mesh-bvh-0.9.15/, MIT).
 *
 * three.js tests a ray against every triangle of a mesh. Draw, Lay flat, Remove
 * and the section sheet's hover cast a ray at the part on each pointer move, and
 * on a 1.56M-face mini that was 63-75 ms a move: the cursor lagged the mouse. A
 * BVH over the same triangles answers in ~0.04 ms with the same hits (face index
 * and distance, every hit, so keptHit's section-cut filter sees the same list).
 *
 * Built lazily, on a mesh's first pick, and only for meshes big enough to need it:
 * the build is ~0.6 s on that mini, so paying it at load would undo part of what
 * the faster weld bought, and most visits orbit before they ever pick. `indirect`
 * keeps the geometry untouched (no index is added, triangle order is unchanged), so
 * nothing else that reads the part's positions or face colours can tell.
 *
 * Every mesh this applies to gets fresh geometry when its triangles change
 * (setPart, meshFrom), and the BVH lives on the geometry, so it can't go stale.
 * The library loads in the background; until it lands, picks take the old path.
 */
import * as THREE from 'three';

const MIN_FACES = 20000;   // below this the plain test is already well under a ms

const plain = THREE.Mesh.prototype.raycast;

import('../vendor/three-mesh-bvh-0.9.15/three-mesh-bvh.module.js').then(({ acceleratedRaycast, computeBoundsTree }) => {
  THREE.Mesh.prototype.raycast = function (raycaster, intersects) {
    const g = this.geometry;
    const p = g?.getAttribute('position');
    if (!g?.boundsTree && p && !g.index && p.count / 3 >= MIN_FACES) {
      computeBoundsTree.call(g, { indirect: true });
    }
    return g?.boundsTree ? acceleratedRaycast.call(this, raycaster, intersects)
                         : plain.call(this, raycaster, intersects);
  };
}).catch((err) => console.warn('fast picks unavailable; using three.js raycast', err));
