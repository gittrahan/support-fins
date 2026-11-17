// Disposable export worker: no project, mesh or WASM resources survive a file.
import { matchContactMaterials } from './contact-materials.js';
import { partitionSupportMaterials } from './support-materials.js';
import { supportMaterialWarnings } from './support-material-warnings.js';
self.onmessage = async ({ data }) => {
  try {
    const result = await (data.matching ? matchContactMaterials(data.triangles, data.matching) : partitionSupportMaterials(data.triangles));
    if (data.settings) result.warnings = supportMaterialWarnings(result.parts, data.settings);
    self.postMessage({ result });
  }
  catch (error) { self.postMessage({ error: error.message }); }
};
