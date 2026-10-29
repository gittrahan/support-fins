import { assert, assertEquals, assertThrows } from 'jsr:@std/assert';
import { CHECKS, VERSION_RE, cardHTML, isNewer, nextVersion, releases, stamp, unreleased, versionHTML, withChangelog } from '../web/changelog.js';

const data = JSON.parse(await Deno.readTextFile(new URL('../web/changelog.json', import.meta.url)));

function wellFormed(e, at) {
  assert(e.pr === undefined || (Number.isInteger(e.pr) && e.pr > 0), `${at}: pr is optional, a positive integer`);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(e.date) && !isNaN(Date.parse(e.date)), `${at}: date`);
  assert(typeof e.text === 'string' && e.text.length > 0 && e.text.length <= 240 && !e.text.includes('\n'), `${at}: one short line`);
  assert(CHECKS.includes(e.check), `${at}: check ${e.check}`);
  for (const h of e.highlights ?? []) {
    assert(typeof h.text === 'string' && h.text.length > 0 && h.text.length <= 160 && !h.text.includes('\n'), `${at}: a highlight is one short line`);
    assert(h.prs === undefined || (Array.isArray(h.prs) && h.prs.every((n) => Number.isInteger(n) && n > 0)), `${at}: highlight prs`);
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

Deno.test('changelog: index.html carries the card and version written from changelog.json (deno run -A web/changelog.js)', async () => {
  const html = await Deno.readTextFile(new URL('../web/index.html', import.meta.url));
  assertEquals(withChangelog(html, data), html, 'stale: run deno run -A web/changelog.js');
});

Deno.test('changelog: the card lists released entries only, newest release first, highlights in place of text', () => {
  const d0 = { releases: [], unreleased: [{ date: '2026-10-27', check: 'all', text: 'big', highlights: [{ text: 'one' }, { text: 'two <b>' }] }] };
  assertEquals(cardHTML(d0), '', 'nothing released: no section');
  assertEquals(versionHTML(d0), '');
  const d1 = stamp(d0, '1.0.0', '2026-10-28');
  const d2 = stamp({ ...d1, unreleased: [{ date: '2026-11-01', check: 'held', text: 'later' }, { date: '2026-11-02', check: 'held', text: 'last' }] }, '1.0.1', '2026-11-03');
  const card = cardHTML(d2);
  const items = [...card.matchAll(/<li>(.*?)<\/li>/g)].map((m) => m[1]);
  assertEquals(items, ['last', 'later', 'one', 'two &lt;b&gt;'], 'newest first, escaped, the roll-up text left out');
  assert(card.includes('<span class="ver">v1.0.1</span>') && card.includes('<p class="rel">v1.0.0 <span>2026-10-28</span></p>'));
  assert(!card.includes('<p class="rel">v1.0.1'), 'the newest release is named in the heading, not again above its list');
  assert(versionHTML(d2).includes('>v1.0.1</small>'));
  const html = '<a><!-- BEGIN version (web/changelog.js writes this block) --><!-- END version --></a>\n  <!-- BEGIN whatsnew (web/changelog.js writes this block) -->\n  <!-- END whatsnew -->';
  const once = withChangelog(html, d2);
  assertEquals(withChangelog(once, d2), once, 'rewriting is idempotent');
  assertEquals(withChangelog(once, d0), withChangelog(html, d0), 'and goes back to empty');
  assertThrows(() => withChangelog('<p></p>', d2), Error, 'markers');
});

Deno.test('changelog: the first release lists the ten highlights since launch', () => {
  // before v1.0.0 ships, render it stamped; after, the card is what it is
  const released = releases(data).length ? data : stamp(data, nextVersion(data), '2026-10-28');
  const card = cardHTML({ ...released, releases: released.releases.slice(0, 1) });
  assertEquals([...card.matchAll(/<li>/g)].length, 10);
});
