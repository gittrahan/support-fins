// Scale per axis (#440) -- the badge's tooltip, Uniform and its tooltip -- are
// translated in every locale, and every key still matches the English the page
// shows, so a reworded string can't leave a stale key behind.
import { assert } from 'jsr:@std/assert';

const KEYS = {
  'web/index.html': ['Scale the part by a size or a percent, on each axis or all together.', 'Uniform',
    'On: the three axes scale together. Off: each axis scales on its own, along the plate.'],
};

Deno.test('scale i18n: every new string is in the source and every locale', async () => {
  for (const [file, keys] of Object.entries(KEYS)) {
    const src = await Deno.readTextFile(new URL(`../${file}`, import.meta.url));
    for (const k of keys) assert(src.includes(k), `${file} no longer says "${k}"; update the key`);
  }
  for (const lang of ['de', 'nl', 'pt', 'zh', 'ar']) {
    const { default: dict } = await import(`../web/i18n/${lang}.js`);
    for (const k of Object.values(KEYS).flat()) {
      assert(typeof dict[k] === 'string' && dict[k].length, `${lang} is missing "${k}"`);
    }
    assert(!('Scale the part by a percent.' in dict), `${lang} keeps the old Scale tooltip`);
  }
});
