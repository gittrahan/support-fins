/**
 * STEP tessellation worker (classic, not a module: the OpenCascade build is an
 * Emscripten script loaded with importScripts). Receives { bytes, params },
 * returns the kernel's result with typed arrays transferred back rather than
 * cloning big plain arrays. See step.js.
 */
importScripts('./vendor/occt-import-js/occt-import-js.js');

let occt = null;

onmessage = async (e) => {
  try {
    occt ??= await occtimportjs({ locateFile: (f) => `./vendor/occt-import-js/${f}` });
    const r = occt.ReadStepFile(e.data.bytes, e.data.params);
    const transfer = [];
    for (const m of r.meshes ?? []) {
      m.attributes.position.array = new Float32Array(m.attributes.position.array);
      m.index.array = new Uint32Array(m.index.array);
      delete m.attributes.normal;               // the app computes its own
      delete m.brep_faces;
      transfer.push(m.attributes.position.array.buffer, m.index.array.buffer);
    }
    postMessage(r, transfer);
  } catch (err) {
    postMessage({ error: String(err?.message ?? err) });
  }
};
