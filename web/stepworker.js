/**
 * STEP tessellation worker (classic, not a module: the OpenCascade build is an
 * Emscripten script loaded with importScripts). Receives { bytes, params },
 * returns the kernel's result with typed arrays transferred back rather than
 * cloning big plain arrays. A { warm: true } message only loads the kernel, so
 * the download can start while the user is still picking a file. See step.js.
 *
 * The vendor folder carries the version so it can be cached for a year
 * (web/_headers): bumping the version is what busts the cache.
 */
const OCCT = './vendor/occt-import-js-0.0.23/';
importScripts(`${OCCT}occt-import-js.js`);

const kernel = occtimportjs({ locateFile: (f) => `${OCCT}${f}` });

onmessage = async (e) => {
  try {
    const occt = await kernel;
    if (e.data.warm) return;
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
    if (!e.data.warm) postMessage({ error: String(err?.message ?? err) });
  }
};
