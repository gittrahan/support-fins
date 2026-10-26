// "The 3D view can't draw" banner (#387): a lost WebGL context shows it, a restored
// one hides it and redraws, and repeated losses reuse the one banner.
import { assert } from './_util.js';

// glfail.js (via i18n.js) needs a document: a stub with just what it touches.
const added = [];
globalThis.document ??= {
  documentElement: {},
  body: { appendChild: (n) => added.push(n) },
  createElement: () => ({ hidden: false, textContent: '', setAttribute() {} }),
};
const { watchGl } = await import('../web/ui/glfail.js');

function fakeCanvas() {
  const on = {};
  return {
    addEventListener: (type, fn) => { on[type] = fn; },
    fire: (type) => on[type]?.(),
  };
}

Deno.test('glfail: lost shows the banner, restored hides it and redraws', () => {
  const canvas = fakeCanvas();
  let redraws = 0;
  watchGl(canvas, () => redraws++);
  canvas.fire('webglcontextlost');
  assert(added.length === 1 && !added[0].hidden, 'banner not shown on loss');
  assert(/stopped drawing/.test(added[0].textContent), `text: ${added[0].textContent}`);
  canvas.fire('webglcontextrestored');
  assert(added[0].hidden && redraws === 1, 'restore must hide the banner and redraw');
  canvas.fire('webglcontextlost');
  assert(added.length === 1 && !added[0].hidden, 'a second loss reuses the one banner');
});
