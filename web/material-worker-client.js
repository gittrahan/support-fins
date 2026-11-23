import { partitionSupportMaterials } from './support-materials.js';
import { supportMaterialWarnings } from './support-material-warnings.js';

/** Keep expensive optional export booleans off the UI thread where available. */
export function partitionSupportExport(triangles, settings) {
  const inline = async () => {
    const result = await partitionSupportMaterials(triangles);
    return settings ? { ...result, warnings: supportMaterialWarnings(result.parts, settings) } : result;
  };
  let worker;
  try { worker = new Worker(new URL('./materialworker.js', import.meta.url), { type: 'module' }); }
  catch { return inline(); }
  return new Promise((resolve, reject) => {
    const done = () => { worker.terminate(); worker.onmessage = worker.onerror = null; };
    worker.onmessage = ({ data }) => {
      done();
      if (data.error) reject(new Error(data.error)); else resolve(data.result);
    };
    // A host can forbid module workers while permitting inline execution.
    worker.onerror = (event) => {
      event.preventDefault(); done();
      inline().then(resolve, reject);
    };
    try { worker.postMessage({ triangles, settings }); } catch (error) { done(); reject(error); }
  });
}
