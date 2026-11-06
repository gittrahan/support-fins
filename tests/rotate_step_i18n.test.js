// The Rotate buttons turn 45 degrees: the code, the labels and every locale agree.
import { assert } from 'jsr:@std/assert';

const KEYS = [
  'Rotate 45°',
  'Turn the part: 45° steps, Reset, Lay a face flat and the rotate rings.',
  'The rotate rings around the part. Off hides them; Rotate 45°, Reset and Lay a face flat still turn the part.',
];

Deno.test('rotate step: the buttons turn 45 degrees', async () => {
  const src = await Deno.readTextFile(new URL('../web/ui/pose.js', import.meta.url));
  assert(src.includes('const STEP = Math.PI / 4;'), 'web/ui/pose.js changed the step; update the labels');
});

Deno.test('rotate step i18n: on the page and in every locale, saying 45', async () => {
  const html = await Deno.readTextFile(new URL('../web/index.html', import.meta.url));
  for (const key of KEYS) assert(html.includes(key), `web/index.html no longer says: ${key}`);
  for (const lang of ['de', 'nl', 'pt', 'zh', 'ar']) {
    const { default: dict } = await import(`../web/i18n/${lang}.js`);
    for (const key of KEYS) {
      assert(typeof dict[key] === 'string' && dict[key].includes('45'), `${lang} is missing: ${key}`);
    }
  }
});
