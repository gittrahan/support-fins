/**
 * STEP (ISO 10303-21) import.
 *
 * STEP is exact B-rep geometry, not triangles, so reading it takes a real CAD
 * kernel: OpenCascade compiled to WASM (occt-import-js, vendored under
 * vendor/occt-import-js-<version>, LGPL-2.1). It is ~7.6 MB (~2.9 MB brotli), so
 * it is fetched only when someone reaches for a file (warmStep), cached for a
 * year after that, and it tessellates in a worker so a big assembly doesn't
 * freeze the page.
 *
 * The kernel hands back indexed meshes plus the file's assembly tree; this
 * module turns those into the same per-object triangle soups readThreeMF
 * returns ({ name, positions, tris, meshes, bbox }), so the object picker and
 * everything downstream treat a STEP exactly like a multi-object 3MF.
 */

/**
 * Tessellation tolerances. The triangles we make here ARE the part the export
 * bakes in, so this sets print quality: 0.01 mm chord error is below any
 * printer's resolution, and 0.1 rad (~5.7 deg) caps the facet angle on small
 * radii (a 3 mm hole gets ~60 sides). Output is always millimetres -- OCCT
 * converts from whatever unit the file declares.
 */
export const STEP_PARAMS = {
  linearUnit: 'millimeter',
  linearDeflectionType: 'absolute_value',
  linearDeflection: 0.01,
  angularDeflection: 0.1,
};

/**
 * Sniff a STEP file from its CONTENT: every Part 21 file opens with the
 * "ISO-10303-21;" magic (after an optional BOM / leading whitespace).
 */
export function isStep(buffer) {
  const head = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(64, buffer.byteLength)));
  return /^﻿?\s*ISO-10303-21\s*;/.test(head);
}

const bbox = (positions) => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (positions[i + k] < lo[k]) lo[k] = positions[i + k];
      if (positions[i + k] > hi[k]) hi[k] = positions[i + k];
    }
  }
  return { lo, hi, size: hi.map((h, k) => h - lo[k]) };
};

/** Every mesh index under a node of the assembly tree. */
function subtreeMeshes(node, out = []) {
  out.push(...(node.meshes ?? []));
  for (const c of node.children ?? []) subtreeMeshes(c, out);
  return out;
}

/**
 * The kernel's result -> pickable objects.
 *
 * What counts as "one object" comes from the assembly tree: walk down through
 * single-child wrapper nodes (the file root, a lone top-level assembly) to the
 * first level that actually branches, and make each branch one object with all
 * its meshes merged. A one-body file is one object; a plate of bodies or an
 * assembly of parts goes to the picker, like a multi-object 3MF.
 *
 * @param result  occt-import-js ReadStepFile output (positions/indices may be
 *                plain arrays or typed arrays)
 * @returns { objects: [{ name, positions:Float32Array, tris, meshes, bbox }] }
 */
export function stepObjects(result) {
  if (!result?.success) throw new Error('the CAD kernel could not read this STEP file');

  let node = result.root ?? { name: '', meshes: result.meshes.map((_, i) => i), children: [] };
  while (!node.meshes?.length && node.children?.length === 1) node = node.children[0];
  const groups = node.meshes?.length || !node.children?.length
    ? [node]                                    // leaf body, or meshes at this level
    : node.children;

  const objects = [];
  for (const g of groups) {
    const ids = subtreeMeshes(g);
    let tris = 0;
    for (const i of ids) tris += result.meshes[i].index.array.length / 3;
    if (!tris) continue;

    // Indexed -> flat soup, [x,y,z] x 3 per triangle: the STLLoader layout.
    const positions = new Float32Array(tris * 9);
    let o = 0;
    for (const i of ids) {
      const p = result.meshes[i].attributes.position.array;
      const idx = result.meshes[i].index.array;
      for (let t = 0; t < idx.length; t++) {
        const v = idx[t] * 3;
        positions[o++] = p[v]; positions[o++] = p[v + 1]; positions[o++] = p[v + 2];
      }
    }
    objects.push({
      name: g.name || result.meshes[ids[0]]?.name || `Body ${objects.length + 1}`,
      positions,
      tris,
      meshes: ids.length,
      bbox: bbox(positions),
    });
  }

  if (!objects.length) throw new Error('this STEP file contains no solid geometry');
  return { objects };
}

let worker = null;

const stepWorker = () => (worker ??= new Worker(new URL('./stepworker.js', import.meta.url)));

/**
 * Start fetching and compiling the kernel before a STEP arrives -- called when
 * the user opens the file dialog or drags a file over the page, so the ~3 MB
 * download overlaps with them choosing the file. Harmless if it never gets used.
 */
export function warmStep() {
  if (!worker) stepWorker().postMessage({ warm: true });
}

/**
 * Read a STEP file in the browser. The kernel worker is kept after first use,
 * so the WASM compiles once per page load; a failure drops it so the next
 * attempt starts clean (e.g. after a network blip during the download).
 *
 * @param bytes  Uint8Array of the whole .step file
 */
export async function readStep(bytes) {
  const w = stepWorker();
  const result = await new Promise((resolve, reject) => {
    const fail = (msg) => { w.terminate(); if (worker === w) worker = null; reject(new Error(msg)); };
    w.onmessage = (e) => (e.data.error ? fail(e.data.error) : resolve(e.data));
    w.onerror = (e) => fail(e.message || 'the STEP reader failed to load');
    w.postMessage({ bytes, params: STEP_PARAMS });
  });
  return stepObjects(result);
}
