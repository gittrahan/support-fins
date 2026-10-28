// Suggest orientation runs in a Worker (web/suggestworker.js), with the page's
// tunables applied first. Its ranking has to be the one the page used to compute
// itself, with the default settings and with a changed Support gap -- on a torus,
// whose finalists all take walls, so the gap really changes the answer (checked
// below, or the test would prove nothing about the tunables reaching the Worker).
import { WEB, assert, loadModel } from './_util.js';

const { suggestOrientations } = await import(`${WEB}orient.js`);
const { applyTunables } = await import(`${WEB}fins.js`);
const { PROP } = await import(`${WEB}prop.js`);

function inWorker(topo, threshold, tunables) {
  const w = new Worker(new URL('../web/suggestworker.js', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    w.onmessage = (e) => {
      if (e.data.progress !== undefined) return;   // heartbeats; the ranking comes last
      w.terminate(); e.data.error ? reject(new Error(e.data.error)) : resolve(e.data.ranked);
    };
    w.onerror = (e) => { w.terminate(); reject(e); };
    w.postMessage({ id: 1, topology: { ...topo }, threshold, tunables });
  });
}

const ranked = {};
for (const gap of [undefined, 0.35]) {
  Deno.test(`suggest worker ranks exactly as the page did (torus, gap ${gap ?? 'default'})`, async () => {
    const topo = loadModel('torus');
    const before = PROP.gap;
    const got = await inWorker(topo, 45, gap === undefined ? undefined : { propGap: gap });
    ranked[gap ?? 'default'] = JSON.stringify(got);
    try {
      if (gap !== undefined) applyTunables({ propGap: gap });
      const want = suggestOrientations(topo, { top: 3, threshold: 45 });
      assert(JSON.stringify(got) === JSON.stringify(want), `worker ranking differs:\n${JSON.stringify(got)}\nvs\n${JSON.stringify(want)}`);
    } finally {
      PROP.gap = before;
      applyTunables({ propGap: before });
    }
  });
}

Deno.test('the changed gap changes the torus ranking (so the tests above test the tunables)', () => {
  assert(ranked.default && ranked['0.35'], 'run with the two tests above');
  assert(ranked.default !== ranked['0.35'], 'gap 0.35 ranked the torus exactly like 0.2');
});

// The page shows the Worker's progress on the Suggest button, so it must report
// after every pose, climbing to 1 before the ranking arrives.
Deno.test('suggest worker reports progress after every pose, climbing to 1', async () => {
  const topo = loadModel('torus');
  const w = new Worker(new URL('../web/suggestworker.js', import.meta.url), { type: 'module' });
  const seen = [];
  const ranked = await new Promise((resolve, reject) => {
    w.onmessage = (e) => {
      if (e.data.progress !== undefined) { assert(e.data.id === 7, 'progress without its id'); seen.push(e.data.progress); return; }
      w.terminate(); e.data.error ? reject(new Error(e.data.error)) : resolve(e.data.ranked);
    };
    w.onerror = (e) => { w.terminate(); reject(e); };
    w.postMessage({ id: 7, topology: { ...topo }, threshold: 45 });
  });
  assert(ranked.candidates.length, 'no ranking');
  assert(seen.length >= 6, `only ${seen.length} progress messages`);
  for (let i = 1; i < seen.length; i++) assert(seen[i] > seen[i - 1], `progress went ${seen[i - 1]} -> ${seen[i]}`);
  assert(Math.abs(seen.at(-1) - 1) < 1e-9, `progress ended at ${seen.at(-1)}`);
});
