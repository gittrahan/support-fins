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
    w.onmessage = (e) => { w.terminate(); e.data.error ? reject(new Error(e.data.error)) : resolve(e.data.ranked); };
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
