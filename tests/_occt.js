// The vendored occt-import-js (web/step.js's STEP reader), loaded for Deno: tests/step.test.js
// and plugins/freecad/tests/site_step.js. It is a CommonJS/UMD file, and on Windows Deno's
// require() of it comes back as an empty ESM namespace instead of the factory, so evaluate
// it as CommonJS by hand. Adapted from MiSTRFiNGA/support-fins (9dd02d6).
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const OCCT = fileURLToPath(new URL('../web/vendor/occt-import-js-0.0.23/', import.meta.url));

/** The initialised occt module (ReadStepFile etc.). */
export async function loadOcct() {
  const file = `${OCCT}occt-import-js.js`, module = { exports: {} };
  new Function('module', 'exports', 'require', '__filename', '__dirname', Deno.readTextFileSync(file))(
    module, module.exports, createRequire(import.meta.url), file, OCCT);
  return await module.exports({ wasmBinary: Deno.readFileSync(`${OCCT}occt-import-js.wasm`) });
}
