import { assert, assertEquals, assertThrows } from 'jsr:@std/assert';
import { CHECKS, VERSION_RE, isNewer, nextVersion, releases, stamp, unreleased } from '../web/changelog.js';

const data = JSON.parse(await Deno.readTextFile(new URL('../web/changelog.json', import.meta.url)));

function wellFormed(e, at) {
  assert(e.pr === undefined || (Number.isInteger(e.pr) && e.pr > 0), `${at}: pr is optional, a positive integer`);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(e.date) && !isNaN(Date.parse(e.date)), `${at}: date`);
  assert(typeof e.text === 'string' && e.text.length > 0 && e.text.length <= 240 && !e.text.includes('\n'), `${at}: one short line`);
  assert(CHECKS.includes(e.check), `${at}: check ${e.check}`);
  for (const g of e.summary ?? []) {
    assert(CHECKS.includes(g.check) && Array.isArray(g.items) && g.items.length, `${at}: summary group`);
  }
}

Deno.test('changelog.json: entries are well formed, releases run oldest first with rising versions', () => {
  assert(Array.isArray(data.releases) && Array.isArray(data.unreleased));
  data.releases.forEach((r, i) => {
    assert(VERSION_RE.test(r.version), `release ${i}: version ${r.version}`);
    assert(/^\d{4}-\d{2}-\d{2}$/.test(r.date), `v${r.version}: date`);
    assert(Array.isArray(r.entries) && r.entries.length, `v${r.version}: entries`);
    if (i) assert(isNewer({ releases: data.releases.slice(0, i) }, r.version), `v${r.version} comes after the release before it`);
  });
  const all = [...data.releases.flatMap((r) => r.entries), ...data.unreleased];
  assert(all.length > 0);
  all.forEach((e, i) => wellFormed(e, `entry ${i}`));
  for (let i = 1; i < all.length; i++) assert(all[i].date >= all[i - 1].date, `entry ${i}: dates run oldest first`);
});

Deno.test('changelog: stamp moves unreleased under the version, and versions only go up', () => {
  const d0 = { releases: [], unreleased: [{ date: 'a' }, { date: 'b' }] };
  assertEquals(nextVersion(d0), '1.0.0');
  const d1 = stamp(d0, '1.0.0', '2026-10-28');
  assertEquals(d1.unreleased, []);
  assertEquals(releases(d1).map((r) => [r.tag, r.entries.length]), [['v1.0.0', 2]]);
  assertEquals(d0.unreleased.length, 2, 'stamp leaves its input alone');
  const d2 = stamp({ ...d1, unreleased: [{ date: 'c' }] }, nextVersion(d1), '2026-10-29');
  assertEquals(releases(d2).map((r) => r.version), ['1.0.1', '1.0.0'], 'newest first');
  assert(isNewer(d2, '1.1.0') && isNewer(d2, '2.0.0') && isNewer(d2, '1.0.10'));
  assert(!isNewer(d2, '1.0.1') && !isNewer(d2, '1.0.0') && !isNewer(d2, '0.9.9') && !isNewer(d2, 'v1.0.2'));
  assertThrows(() => stamp({ ...d2, unreleased: [{ date: 'd' }] }, '1.0.1', '2026-10-30'), Error, 'not above');
  assertThrows(() => stamp(d2, '1.0.2', '2026-10-30'), Error, 'nothing unreleased');
  assertThrows(() => stamp({ ...d2, unreleased: [{ date: 'd' }] }, '1.0.2', '10/30/2026'), Error, 'YYYY-MM-DD');
  assert(!VERSION_RE.test('01.0.0'), 'no leading zeros: the tag must match the version');
  assert(VERSION_RE.test(nextVersion(d2)));
});

Deno.test('changelog: malformed data gives nothing', () => {
  assertEquals(releases(null), []);
  assertEquals(unreleased({ unreleased: 3 }), []);
  assertEquals(releases({ releases: [{ version: 'x' }] }), []);
});
