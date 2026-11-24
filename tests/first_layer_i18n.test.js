import { assert } from './_util.js';

// The First layer field (web/index.html #firstlayer-fld) and its tooltip.
Deno.test('first layer field is translated in every locale', async () => {
  const html = await Deno.readTextFile(new URL('../web/index.html', import.meta.url));
  const label = html.match(/id="firstlayer-fld"[^>]*title="([^"]+)"/);
  assert(label, 'the First layer field has a tooltip');
  for (const lang of ['nl', 'de', 'pt', 'zh', 'ar']) {
    const { default: dict } = await import(`../web/i18n/${lang}.js`);
    for (const key of ['First layer', label[1].replaceAll('&#39;', "'")]) {
      assert(dict[key] && dict[key] !== key, `${lang}: missing ${key}`);
    }
  }
});
