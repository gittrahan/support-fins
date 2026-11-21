import { assert, assertEquals } from 'jsr:@std/assert';
import nl from '../web/i18n/nl.js';
import de from '../web/i18n/de.js';
import pt from '../web/i18n/pt.js';
import zh from '../web/i18n/zh.js';
import ar from '../web/i18n/ar.js';
Deno.test('browser material matching: all labels, messages and placeholders are translated', async () => {
  const html = await Deno.readTextFile(new URL('../web/index.html', import.meta.url));
  const section = html.slice(
    html.indexOf('id="match-materials-fld"'),
    html.indexOf('<div class="sec placement">'),
  );
  const ui = await Deno.readTextFile(new URL('../web/ui/materials.js', import.meta.url));
  const keys = [...section.matchAll(/data-i18n="([^"]+)"/g), ...ui.matchAll(/\bt\('([^']+)'/g)].map((
    m,
  ) => m[1]);
  for (const key of keys) {
    for (const [lang, dict] of Object.entries({ nl, de, pt, zh, ar })) {
      assert(dict[key], `${lang}: ${key}`);
      assertEquals(
        [...dict[key].matchAll(/\{[^}]+\}/g)].map((m) => m[0]).sort(),
        [...key.matchAll(/\{[^}]+\}/g)].map((m) => m[0]).sort(),
      );
    }
  }
});
