import { assert, assertEquals } from 'jsr:@std/assert';
import { analyze, fins, tiltedBlockTopo } from './_util.js';
import { nominalContext } from '../web/fins/printability.js';
import { inspectFins } from '../web/fins.js';
import { computeFins } from '../plugins/shared/engine/fins_entry.js';

const rot = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const opts = { mode: 'auto', tines: true, bedPad: false, layerHeight: 0.2,
  tunables: { nozzle: 0.4, wallLines: 2, tineDir: 'horizontal', propGap: 0.2, cutout: 'none' } };

Deno.test('support diagnostics: worker displays geometry before a separate inspection request', async () => {
  const topo = tiltedBlockTopo(-10, 10, -10, 10, -10, 10, 35), result = analyze(topo, 45, rot);
  const workerTopo = structuredClone(topo);
  const before = { over: result.over.slice(), kept: result.kept.slice() };
  const plain = fins.buildFins(topo, result, rot, opts);
  const diagnosed = { ...opts, diagnostics: nominalContext(0.2, 0.4, 0.2) };
  const inline = inspectFins(topo, result, rot, plain, diagnosed);
  const worker = new Worker(new URL('../web/finworker.js', import.meta.url), { type: 'module' });
  const output = await new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      if (data.progress) return;
      if (data.built) {
        assertEquals(data.built, plain, 'worker generation performed inspection or changed geometry');
        assertEquals(data.built.printability, undefined);
        worker.postMessage({ type: 'inspect', id: data.id });
        return;
      }
      worker.terminate();
      if (data.error || data.inspectionError) reject(new Error(data.error || data.inspectionError)); else resolve(data);
    };
    worker.onerror = (e) => { worker.terminate(); reject(e); };
    worker.postMessage({ id: 72, topology: workerTopo, result, rot, opts: diagnosed });
  });
  assertEquals(output.id, 72);
  assertEquals(output.inspection, inline);
  assertEquals(plain, fins.buildFins(topo, result, rot, opts), 'inspection mutated the build');
  assertEquals(result.over, before.over); assertEquals(result.kept, before.kept);
  assertEquals(inline.printability.status, 'complete');
  assert(inline.coverage.points.every((p) => p.length === 4));
  assertEquals(inline.coverage.sourceFaces.length, inline.coverage.points.length);
  for (const faces of inline.coverage.sourceFaces) for (const f of faces) assert(result.over[f] && result.kept[f]);
});

Deno.test('support diagnostics: synchronous adapter geometry and piece IDs are unchanged', () => {
  const topo = tiltedBlockTopo(-10, 10, -10, 10, -10, 10, 35);
  for (const mode of ['auto', 'full']) {
    const plain = computeFins(topo.pos, { mode, padStyle: 'off' });
    assertEquals(plain.diagnostics, null, 'host did not opt in to expensive inspection');
    assertEquals(plain, computeFins(topo.pos, { mode, padStyle: 'off', diagnostics: false }));
    const checked = computeFins(topo.pos, { mode, padStyle: 'off', diagnostics: true });
    assert(!(checked instanceof Promise));
    assertEquals(checked.triangles, plain.triangles); assertEquals(checked.pieces, plain.pieces);
    assertEquals(checked.overFaces, plain.overFaces); assertEquals(checked.smallFaces, plain.smallFaces);
    assertEquals(checked.stats.braces, plain.stats.braces); assertEquals(checked.stats.tines, plain.stats.tines);
    assertEquals(checked.stats.unserved, plain.stats.unserved);
    assert(checked.diagnostics.support.status === 'complete');
  }
  assertEquals(computeFins(topo.pos, { tineDir: 'vertical', padStyle: 'off' }).diagnostics, null);
  const result = analyze(topo, 45, rot);
  assertEquals(fins.buildFins(topo, result, rot, { ...opts, mode: 'draw', diagnostics: nominalContext(0.2, 0.4, 0.2) }).printability, undefined);
});
