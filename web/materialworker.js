// Disposable export worker: no project, mesh or WASM resources survive a file.
import { partitionSupportMaterials } from './support-materials.js';
self.onmessage = async ({ data }) => {
  try { self.postMessage({ result: await partitionSupportMaterials(data.triangles) }); }
  catch (error) { self.postMessage({ error: error.message }); }
};
