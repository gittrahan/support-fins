import { assert, blockTopo } from './_util.js';
import { workerLimit, CpuPolicy } from '../web/cpu-policy.js';
import { DrawPool } from '../web/draw-pool.js';

Deno.test('CPU ceilings handle weak, unknown and many-core hardware plus model-copy pressure', () => {
  const small = blockTopo(-10, 10, -10, 10, 0, 20);
  for (const [cores, want] of [[1, 1], [2, 1], [4, 2], [6, 3], [8, 4], [32, 4], [NaN, 1], [0, 1]]) {
    assert(workerLimit({ cores, memory: 8 }, small) === want, String(cores));
  }
  assert(workerLimit({ cores: 32, memory: 1 }, { nFaces: 196608, pos: new Float32Array(196608 * 9) }) === 1);
  assert(workerLimit({ cores: 32, memory: 8 }, { nFaces: 1000000 }) === 1);
  assert(workerLimit({}, small) === 1, 'unknown hints must be conservative');
});

Deno.test('CPU policy ramps only for large batches with measured gain and backs off with hysteresis', () => {
  let now = 0;
  const p = new CpuPolicy(4, () => now);
  assert(p.choose(8) === 1);
  p.observe({ width: 1, count: 8, workMs: 10, elapsedMs: 10 });
  assert(p.choose(8) === 1);
  p.observe({ width: 1, count: 8, workMs: 100, elapsedMs: 100 });
  assert(p.choose(8) === 2);
  p.observe({ width: 2, count: 8, workMs: 100, elapsedMs: 1000, cold: true });
  assert(p.choose(8) === 2, 'allow one warm trial before judging startup');
  p.observe({ width: 2, count: 8, workMs: 100, elapsedMs: 60 });
  assert(p.choose(8) === 3);
  p.observe({ width: 3, count: 8, workMs: 100, elapsedMs: 40 });
  assert(p.choose(8) === 4);
  p.pressure(true); p.pressure(false);
  assert(p.choose(8) === 1);
  p.observe({ width: 1, count: 8, workMs: 100, elapsedMs: 100 });
  assert(p.width === 1, 'pressure hold must not ramp');
  now = 10001;
  p.observe({ width: 1, count: 8, workMs: 100, elapsedMs: 100 });
  assert(p.choose(8) === 2);
  p.observe({ width: 2, count: 8, workMs: 100, elapsedMs: 120 });
  assert(p.choose(8) === 1 && p.holdUntil === now + 30000, 'transfers erase gain');
});

Deno.test('pool stops dispatching extra lanes under pressure, preserves order and frees failed workers', async () => {
  let tick = 0, running = 0, peak = 0, made = 0, disposed = 0;
  const pending = [];
  const model = { nFaces: 1 };
  const pool = new DrawPool(model, { cores: 8, memory: 8 }, () => {
    made++;
    return { run: (_channel, received, w) => {
      assert(received === model); peak = Math.max(peak, ++running);
      return new Promise((resolve) => pending.push(() => {
        running--; tick += 20; resolve({ built: w.a, computeMs: 20 });
      }));
    }, dispose: () => disposed++ };
  }, () => tick);
  pool.policy.width = 4;
  const job = { requests: Array.from({ length: 8 }, (_, i) => ({ a: [i] })), options: {} };
  const building = pool.build(job, () => { throw new Error('unexpected serial'); });
  assert(pending.length === 4 && peak === 4);
  pool.pressure(true);
  while (pending.length) { pending.shift()(); await Promise.resolve(); await Promise.resolve(); }
  const reply = await building;
  assert(reply.candidates.every((r, i) => r[0] === i));
  assert(made === disposed && pool.queues.length === 0, 'pressure left copies resident');
  const failed = new DrawPool(model, { cores: 8, memory: 8 },
    () => ({ run: () => Promise.reject(new Error('no child worker')), dispose: () => disposed++ }));
  failed.policy.width = 2;
  const fallback = await failed.build(job, () => ({ safe: true }));
  assert(fallback.built.safe && fallback.workers === 1 && fallback.fallback);
  failed.dispose();
});
