import { assert } from 'jsr:@std/assert';

// the reason drawnWall gives when a drawn body would run inside the part (shown through t())
const key = 'the wall would cut into the part where its surface steps — draw two lines, one each side of the step';

Deno.test('drawn wall body-cut refusal is translated in every locale', async () => {
  const src = await Deno.readTextFile(new URL('../web/draw.js', import.meta.url));
  assert(src.replace(/'\s*\+\s*'/g, '').includes(key), 'draw.js no longer gives this reason');
  for (const lang of ['nl', 'de', 'pt', 'zh', 'ar']) {
    const { default: dict } = await import(`../web/i18n/${lang}.js`);
    assert(dict[key] && dict[key] !== key, `${lang}: missing ${key}`);
  }
});
