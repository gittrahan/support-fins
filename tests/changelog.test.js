import { assert, assertEquals } from 'jsr:@std/assert';
import { CHECKS, latest, withVersions } from '../web/changelog.js';

const data = JSON.parse(await Deno.readTextFile(new URL('../web/changelog.json', import.meta.url)));

Deno.test('changelog.json: versions derive from position, entries are well formed', () => {
  assert(/^\d+\.\d+$/.test(data.base), 'base is MAJOR.MINOR');
  const entries = withVersions(data);
  assert(entries.length > 0);
  entries.forEach((e, i) => {
    assertEquals(e.tag, `v${data.base}.${i}`);
    assert(/^v\d+\.\d+\.\d+$/.test(e.tag), 'tag is Docker-compatible SemVer');
    assert(e.pr === undefined || (Number.isInteger(e.pr) && e.pr > 0), `${e.tag}: pr is optional, a positive integer`);
    assert(/^\d{4}-\d{2}-\d{2}$/.test(e.date) && !isNaN(Date.parse(e.date)), `${e.tag}: date`);
    assert(typeof e.text === 'string' && e.text.length > 0 && e.text.length <= 240 && !e.text.includes('\n'), `${e.tag}: one short line`);
    assert(CHECKS.includes(e.check), `${e.tag}: check ${e.check}`);
    for (const g of e.summary ?? []) {
      assert(CHECKS.includes(g.check) && Array.isArray(g.items) && g.items.length, `${e.tag}: summary group`);
    }
  });
  for (let i = 1; i < entries.length; i++) assert(entries[i].date >= entries[i - 1].date, `${entries[i].tag}: dates run oldest first`);
});

Deno.test('changelog: latest() is newest first, and malformed data gives nothing', () => {
  const d = { base: '1.2', entries: [{ date: 'a' }, { date: 'b' }, { date: 'c' }] };
  assertEquals(latest(d, 2).map((e) => e.version), ['1.2.2', '1.2.1']);
  assertEquals(withVersions(null), []);
  assertEquals(withVersions({ base: 1 }), []);
});
