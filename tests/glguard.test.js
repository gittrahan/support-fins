// WebGL null guard (#372): Brave Shields on Android answers gl.getParameter with
// null on a live context, which crashed three.js at startup. A null on a live
// context reads as the WebGL 2 floor; a real answer and a lost context pass through.
import { guardContext } from '../web/ui/glguard.js';
import { assert } from './_util.js';

const VERSION = 0x1F02, MAX_TEXTURE_SIZE = 0x0D33, VIEWPORT = 0x0BA2, HIGH_FLOAT = 0x8DF2;

function fakeGl({ lost = false, answer = () => null } = {}) {
  return {
    drawingBufferWidth: 300, drawingBufferHeight: 150,
    isContextLost: () => lost,
    getParameter: answer,
    getShaderPrecisionFormat: () => null,
  };
}

Deno.test('glguard: a shielded live context answers the WebGL 2 floor', () => {
  const warn = console.warn; console.warn = () => {};
  try {
    const gl = guardContext(fakeGl());
    assert(gl.getParameter(VERSION).indexOf('WebGL') === 0, 'VERSION not a WebGL string');
    assert(gl.getParameter(MAX_TEXTURE_SIZE) === 2048, 'MAX_TEXTURE_SIZE floor');
    const vp = gl.getParameter(VIEWPORT);
    assert(vp.length === 4 && vp[2] === 300 && vp[3] === 150, `viewport ${vp}`);
    assert(gl.getShaderPrecisionFormat(0, HIGH_FLOAT).precision > 0, 'precision probe');
    assert(gl.getParameter(0x1234) === null, 'an unknown enum stays null');
  } finally { console.warn = warn; }
});

Deno.test('glguard: real answers and a lost context pass through', () => {
  const real = guardContext(fakeGl({ answer: (n) => (n === VERSION ? 'WebGL 2.0 (OpenGL ES 3.0)' : 8192) }));
  assert(real.getParameter(VERSION) === 'WebGL 2.0 (OpenGL ES 3.0)', 'real VERSION changed');
  assert(real.getParameter(MAX_TEXTURE_SIZE) === 8192, 'real limit changed');
  const lost = guardContext(fakeGl({ lost: true }));
  assert(lost.getParameter(VERSION) === null, 'a lost context must still answer null');
  assert(lost.getShaderPrecisionFormat(0, HIGH_FLOAT) === null, 'lost precision must stay null');
});
