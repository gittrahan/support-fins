/**
 * Guard a WebGL context against a privacy shield that answers queries with null.
 *
 * Brave on Android with Shields up (#237, #372) returns null from
 * gl.getParameter(gl.VERSION) -- and may do the same for other limits -- on a
 * context that otherwise draws fine. three.js reads those at startup
 * (`glVersion.indexOf`, `new Vector4().fromArray(scissorParam)`, the precision
 * probe) and throws, so the page never got past loading. A null answer on a live
 * context now reads as the WebGL 2 spec minimum instead: three sizes its texture
 * slots and shader limits from these, and the minimum is always safe. A lost
 * context still answers null -- that's real, not a shield.
 */

// WebGL 2 minimums (the spec's guaranteed floor), by GLenum value so the table
// doesn't need a context to build.
const FLOOR = {
  0x1F02: 'WebGL 2.0',            // VERSION
  0x8B8C: 'WebGL GLSL ES 3.00',   // SHADING_LANGUAGE_VERSION
  0x1F00: 'WebKit',               // VENDOR
  0x1F01: 'WebKit WebGL',         // RENDERER
  0x8B4D: 32,                     // MAX_COMBINED_TEXTURE_IMAGE_UNITS
  0x8872: 16,                     // MAX_TEXTURE_IMAGE_UNITS
  0x8B4C: 16,                     // MAX_VERTEX_TEXTURE_IMAGE_UNITS
  0x0D33: 2048,                   // MAX_TEXTURE_SIZE
  0x851C: 2048,                   // MAX_CUBE_MAP_TEXTURE_SIZE
  0x8869: 16,                     // MAX_VERTEX_ATTRIBS
  0x8DFB: 256,                    // MAX_VERTEX_UNIFORM_VECTORS
  0x8DFC: 15,                     // MAX_VARYING_VECTORS
  0x8DFD: 224,                    // MAX_FRAGMENT_UNIFORM_VECTORS
  0x8D57: 4,                      // MAX_SAMPLES
  0x8A2F: 24,                     // MAX_UNIFORM_BUFFER_BINDINGS
  0x84FF: 1,                      // MAX_TEXTURE_MAX_ANISOTROPY_EXT
};
const SCISSOR_BOX = 0x0C10, VIEWPORT = 0x0BA2;

/** Wrap `gl` in place so a null answer on a live context gets a safe value. */
export function guardContext(gl) {
  const getParameter = gl.getParameter.bind(gl);
  const getPrecision = gl.getShaderPrecisionFormat.bind(gl);
  let warned = false;
  const note = (what) => {
    if (warned) return;
    warned = true;
    console.warn(`WebGL answered null for ${what}; using safe defaults (a browser privacy shield?)`);
  };
  gl.getParameter = (name) => {
    const v = getParameter(name);
    if (v !== null || gl.isContextLost()) return v;
    if (name === SCISSOR_BOX || name === VIEWPORT) {
      note('the viewport');
      return new Int32Array([0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight]);
    }
    if (Object.hasOwn(FLOOR, name)) { note(`0x${name.toString(16)}`); return FLOOR[name]; }
    return v;
  };
  gl.getShaderPrecisionFormat = (shader, type) => {
    const v = getPrecision(shader, type);
    if (v !== null || gl.isContextLost()) return v;
    note('shader precision');
    return { rangeMin: 127, rangeMax: 127, precision: 23 };   // highp float
  };
  return gl;
}

/** A canvas whose WebGL contexts come back guarded (hand it to WebGLRenderer). */
export function guardedCanvas() {
  const canvas = document.createElement('canvas');
  canvas.style.display = 'block';   // what three's own createCanvasElement sets
  const getContext = canvas.getContext.bind(canvas);
  canvas.getContext = (kind, attrs) => {
    const ctx = getContext(kind, attrs);
    return ctx && /webgl/.test(kind) ? guardContext(ctx) : ctx;
  };
  return canvas;
}
