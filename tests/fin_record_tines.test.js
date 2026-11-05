// #037: the per-wall fin records' tines must match the walls (props, wedges, short and
// fill walls) and sum to the build's total. Auto's record used to copy the prop-mode
// stats, which carry tines 0, so every main-pass wall read 0.

import { loadModel, analyze, fins, assert } from './_util.js';
import { sitePose, siteOpts } from './_scene.js';

for (const [model, deg] of [['lbracket', 35], ['staircase', 40], ['cube', 40], ['portal', 40], ['wedge', 40]]) {
  for (const full of [false, true]) {
    Deno.test(`fin records sum to built.tines: ${model} X${deg}${full ? ' coverage 1' : ''}`, () => {
      const topo = loadModel(model), rot = sitePose([deg, 0, 0]);
      const res = analyze(topo, 45, rot);
      const b = fins.buildFins(topo, res, rot, { ...siteOpts(), ...(full ? { coverage: 1 } : {}) });
      const sum = b.fins.filter((f) => f.kind !== 'sway').reduce((a, f) => a + f.tines, 0);
      assert(b.tines > 0, `${model}: part has tines`);
      assert(sum === b.tines, `${model}: records sum ${sum} vs built.tines ${b.tines}`);
      b.props.forEach((q) => { const f = b.fins.find((r) => r.id === q.id && r.kind === 'prop');
        if (f) assert(f.tines === (q.tines ?? 0), `${model}: wall ${q.id} record ${f.tines} vs prop ${q.tines}`); });
    });
  }
}
