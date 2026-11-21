import { matchContactMaterials } from './contact-materials.js';
import { partitionSupportMaterials } from './support-materials.js';

/** Disposable workers keep optional export/preview booleans off the UI thread.
 * Preview callers can cancel superseded work; exports keep their captured input. */
export function partitionSupportExport(triangles, matching = null, { signal } = {}) {
  const compute = () => matching ? matchContactMaterials(triangles, matching) : partitionSupportMaterials(triangles);
  const aborted = () => new DOMException('Material preview superseded', 'AbortError');
  if (signal?.aborted) return Promise.reject(aborted());
  let worker;
  try { worker = new Worker(new URL('./materialworker.js', import.meta.url), { type: 'module' }); }
  catch { return compute(); }
  return new Promise((resolve, reject) => {
    const done = () => { worker.terminate(); worker.onmessage = worker.onerror = null; signal?.removeEventListener('abort', cancel); };
    const cancel = () => { done(); reject(aborted()); };
    signal?.addEventListener('abort', cancel, { once: true });
    worker.onmessage = ({ data }) => {
      done();
      if (data.error) reject(new Error(data.error)); else resolve(data.result);
    };
    worker.onerror = (event) => {
      event.preventDefault(); done();
      if (signal?.aborted) reject(aborted()); else compute().then(resolve, reject);
    };
    try { worker.postMessage({ triangles, matching }); } catch (error) { done(); reject(error); }
  });
}
