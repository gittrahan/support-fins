// The live Full coverage build (ui/livebuild.js) -- its bar labels, Stop and its
// tooltip, and the readout's stopped-early line -- is translated in every locale,
// keeps its placeholders, and every key still matches the English the page shows.
import { assert } from 'jsr:@std/assert';

const KEYS = {
  'web/index.html': ['Stop', 'Keep the walls shown and finish now'],
  'web/ui/livebuild.js': ['Placing walls…', 'Full coverage · walls added: {n}', 'Comparing layouts…',
    'Stopping: keeping the walls shown…'],
  'web/ui/readout.js': ['Full coverage was stopped early, with {area} mm² of overhang still bare — change any setting to build it in full'],
};
const holes = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join();

Deno.test('live build i18n: every new string is in the source and every locale', async () => {
  for (const [file, keys] of Object.entries(KEYS)) {
    const src = await Deno.readTextFile(new URL(`../${file}`, import.meta.url));
    for (const k of keys) assert(src.includes(k), `${file} no longer says "${k}"; update the key`);
  }
  for (const lang of ['de', 'nl', 'pt', 'zh', 'ar']) {
    const { default: dict } = await import(`../web/i18n/${lang}.js`);
    for (const k of Object.values(KEYS).flat()) {
      const v = dict[k];
      assert(typeof v === 'string' && v.length, `${lang} is missing "${k}"`);
      assert(holes(v) === holes(k), `${lang} "${k}" lost a placeholder: ${v}`);
    }
  }
});
