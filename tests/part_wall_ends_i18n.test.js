import { assert } from 'jsr:@std/assert';

// the reason drawnWall gives when a line runs along a side wall (shown through t())
const key = 'too close to the part’s side wall — draw the line a little further from it';

Deno.test('drawn part wall side-wall refusal is translated in every locale', async () => {
  const src = await Deno.readTextFile(new URL('../web/draw.js', import.meta.url));
  assert(src.includes(key.split(' — ')[0]) && src.includes('draw the line '), 'draw.js no longer gives this reason');
  for (const lang of ['nl', 'de', 'pt', 'zh', 'ar']) {
    const { default: dict } = await import(`../web/i18n/${lang}.js`);
    assert(dict[key] && dict[key] !== key, `${lang}: missing ${key}`);
  }
});
