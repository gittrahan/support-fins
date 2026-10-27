import { assert } from 'jsr:@std/assert';

// the landing card's chrome (entries stay English)
const keys = ["What's new", 'See all releases', 'Version'];

Deno.test("changelog chrome is translated in every locale and present in index.html", async () => {
  const html = await Deno.readTextFile(new URL('../web/index.html', import.meta.url));
  for (const key of keys) assert(new RegExp(`data-i18n(-title)?="${key}"`).test(html), `index.html lost ${key}`);
  for (const lang of ['nl', 'de', 'pt', 'zh', 'ar']) {
    const { default: dict } = await import(`../web/i18n/${lang}.js`);
    for (const key of keys) {
      const same = lang === 'de' && key === 'Version';   // German spells it the same
      assert(dict[key] && (same || dict[key] !== key), `${lang}: missing ${key}`);
    }
  }
});
