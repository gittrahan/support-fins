// The refusal a hand-placed brace gives where a curved side rolls over past 45
// degrees (web/sway.js, GH #351) is translated in every locale, and the key still
// matches the source, so a reworded string can't leave a stale key behind.
import { assert } from 'jsr:@std/assert';

const KEY = 'the face curves over past 45° near the plate there, so a brace can’t follow it up — try a steeper part of the side';

Deno.test('sway curved i18n: the rollover refusal is in the source and every locale', async () => {
  const src = await Deno.readTextFile(new URL('../web/sway.js', import.meta.url));
  assert(src.includes(KEY), 'web/sway.js no longer says this; update the key');
  for (const lang of ['de', 'nl', 'pt', 'zh', 'ar']) {
    const { default: dict } = await import(`../web/i18n/${lang}.js`);
    assert(typeof dict[KEY] === 'string' && dict[KEY].length > 0, `${lang} is missing the rollover refusal`);
    assert(dict[KEY].includes('45°'), `${lang} dropped the angle`);
  }
});
