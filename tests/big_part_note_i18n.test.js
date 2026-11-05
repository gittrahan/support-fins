// The too-big note (stats card, ui/part.js updateFit): translated in every locale,
// and the key still matches the English the page shows.
import { assert } from 'jsr:@std/assert';

const KEY = 'Too big for the build volume — the bigger the part, the longer fins take (minutes on a part metres across).';

Deno.test('big part note i18n: in the source and every locale', async () => {
  const src = await Deno.readTextFile(new URL('../web/ui/part.js', import.meta.url));
  assert(src.includes(KEY), 'web/ui/part.js no longer says it; update the key');
  const html = await Deno.readTextFile(new URL('../web/index.html', import.meta.url));
  assert(html.includes('id="s-big-note"'), 'the note element is gone from the stats card');
  for (const lang of ['de', 'nl', 'pt', 'zh', 'ar']) {
    const { default: dict } = await import(`../web/i18n/${lang}.js`);
    assert(typeof dict[KEY] === 'string' && dict[KEY].length, `${lang} is missing it`);
  }
});
