// Suggest orientation runs in a Worker (web/suggestworker.js), with the page's
// tunables applied first. Its ranking has to be the one the page used to compute
// itself -- with the default settings and with a changed Support gap, which moves
// the finalists' fin counts -- and the Worker's module copy must not leak the
// gap into this thread's.
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

for (const gap of [undefined, 0.35]) {
  Deno.test(`suggest worker ranks exactly as the page did (lbracket, gap ${gap ?? 'default'})`, async () => {
    const topo = loadModel('lbracket');
    const before = PROP.gap;
    const got = await inWorker(topo, 45, gap === undefined ? undefined : { propGap: gap });
    assert(PROP.gap === before, 'the Worker\'s gap leaked into this thread');
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
