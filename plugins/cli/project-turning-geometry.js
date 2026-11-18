// Solid validation and procedural fixture utilities only. Turning wall geometry
// is constructed synchronously by web/prop/turn.js and the ordinary sweep.
let wasmBinary, runtime;
/** The CLI bundle supplies the existing vendored WASM bytes. */
export function setTurningWasm(bytes) { wasmBinary = bytes; runtime = null; }
export function turningRuntime() {
  runtime ??= import('../../web/vendor/manifold-3d-3.5.4/manifold.js').then(async ({ default: init }) => {
    const w = await init(wasmBinary ? { wasmBinary } : {}); w.setup(); return w;
  }).catch((e) => { runtime = null; throw e; });
  return runtime;
}

const round = (n) => Number(n.toFixed(6));
export function triangles(solid) {
  const m = solid.getMesh(), out = [];
  for (const i of m.triVerts) out.push(Array.from(m.vertProperties.slice(i * m.numProp, i * m.numProp + 3), round));
  return out;
}
