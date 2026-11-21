import { partitionSupportMaterials } from './support-materials.js';

/** Keep expensive optional export booleans off the UI thread where available. */
export function partitionSupportExport(triangles) {
  let worker;
  try { worker = new Worker(new URL('./materialworker.js', import.meta.url), { type: 'module' }); }
  catch { return partitionSupportMaterials(triangles); }
  return new Promise((resolve, reject) => {
    const done = () => { worker.terminate(); worker.onmessage = worker.onerror = null; };
    worker.onmessage = ({ data }) => {
      done();
      if (data.error) reject(new Error(data.error)); else resolve(data.result);
    };
    // A host can forbid module workers while permitting inline execution.
    worker.onerror = (event) => {
      event.preventDefault(); done();
      partitionSupportMaterials(triangles).then(resolve, reject);
    };
    try { worker.postMessage({ triangles }); } catch (error) { done(); reject(error); }
  });
}
