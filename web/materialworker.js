// Disposable export worker: no project, mesh or WASM resources survive a file.
import { matchContactMaterials } from './contact-materials.js';
import { partitionSupportMaterials } from './support-materials.js';
self.onmessage = async ({ data }) => {
  try { self.postMessage({ result: await (data.matching ? matchContactMaterials(data.triangles, data.matching) : partitionSupportMaterials(data.triangles)) }); }
  catch (error) { self.postMessage({ error: error.message }); }
};
