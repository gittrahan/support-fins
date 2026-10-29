import { assert } from 'jsr:@std/assert';
import { cardHTML, nextVersion, stamp, versionHTML } from '../web/changelog.js';

// the landing card's chrome (entries stay English)
const keys = ["What's new", 'See all releases', 'Version'];

Deno.test("changelog chrome is translated in every locale and present in the card it writes", async () => {
  // the card exists only once a release does: render the next one
  const data = JSON.parse(await Deno.readTextFile(new URL('../web/changelog.json', import.meta.url)));
  const released = data.unreleased.length ? stamp(data, nextVersion(data), '2026-10-28') : data;
  const html = cardHTML(released) + versionHTML(released);
  for (const key of keys) assert(new RegExp(`data-i18n(-title)?="${key}"`).test(html), `the card lost ${key}`);
  for (const lang of ['nl', 'de', 'pt', 'zh', 'ar']) {
    const { default: dict } = await import(`../web/i18n/${lang}.js`);
    for (const key of keys) {
      const same = lang === 'de' && key === 'Version';   // German spells it the same
      assert(dict[key] && (same || dict[key] !== key), `${lang}: missing ${key}`);
    }
  }
});
