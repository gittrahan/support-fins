import { assert, assertEquals, assertStringIncludes, assertThrows } from 'jsr:@std/assert';
import { changelogLines, collect, notesFor, pendingTags, prepare } from '../.github/scripts/release.js';
import { releases, withChangelog } from '../web/changelog.js';

const entry = (text, extra = {}) => ({ date: '2026-10-28', check: 'held', text, ...extra });
const main0 = { releases: [], unreleased: [entry('first', { highlights: [{ text: 'a plugin', prs: [3, 4] }, { text: 'no prs' }] }), entry('second', { pr: 7 })] };

Deno.test('release: prepare stamps every unreleased entry under the next patch, or the version asked for', () => {
  const p = prepare(main0, '', '2026-10-28');
  assertEquals(p.version, '1.0.0');
  assertEquals(p.data.unreleased, []);
  assertEquals(releases(p.data)[0].entries.map((e) => e.text), ['first', 'second']);
  assertEquals(prepare({ ...p.data, unreleased: [entry('third')] }, '', '2026-10-29').version, '1.0.1');
  assertEquals(prepare({ ...p.data, unreleased: [entry('third')] }, '1.1.0', '2026-10-29').version, '1.1.0');
  assertEquals(prepare(p.data, '', '2026-10-29'), null, 'nothing waiting: nothing to release');
  assertThrows(() => prepare({ ...p.data, unreleased: [entry('x')] }, '1.0.0', '2026-10-29'));
});

Deno.test('release: pending tags are the released versions git has no tag for, oldest first', () => {
  let d = prepare(main0, '', '2026-10-28').data;
  d = prepare({ ...d, unreleased: [entry('third')] }, '', '2026-10-29').data;
  assertEquals(pendingTags(d, []), ['v1.0.0', 'v1.0.1']);
  assertEquals(pendingTags(d, ['v1.0.0']), ['v1.0.1']);
  assertEquals(pendingTags(d, ['v1.0.0', 'v1.0.1', 'v0.9.0']), []);
  assertThrows(() => pendingTags(d, ['v1.0.1']), Error, 'earlier release has no tag');
  assertEquals(pendingTags(main0, []), [], 'unreleased entries are never tagged');
});

Deno.test('release: notes list each entry with its PR, highlights in place of the line, and never @mention', () => {
  const r = releases(prepare({ ...main0, unreleased: [...main0.unreleased, entry('thanks @someone')] }, '', '2026-10-28').data)[0];
  const notes = notesFor(r, 'o/r');
  assertStringIncludes(notes, 'first\n\n- a plugin (#3, #4)\n- no prs\n\n- second (#7)');
  assert(!notes.startsWith('- first'), 'an entry with highlights leads with its text, not a bullet');
  assertStringIncludes(notes, 'ghcr.io/o/r:v1.0.0');
  assert(!/@someone/.test(notes) && notes.includes('@‍someone'));
});

Deno.test('release: the stamped changelog writes the landing card, and the shipped v1.0.0 notes read as ten highlights', async () => {
  const data = JSON.parse(await Deno.readTextFile(new URL('../web/changelog.json', import.meta.url)));
  const html = await Deno.readTextFile(new URL('../web/index.html', import.meta.url));
  const p = prepare(data, '', '2026-10-29');
  if (!p) return;   // already released: nothing to prepare
  const card = withChangelog(html, p.data);
  assertStringIncludes(card, `<span class="ver">v${p.version}</span>`);
  assertStringIncludes(card, `>v${p.version}</small>`);
  // A later feature prepares v1.0.1 (or newer); the ten highlights belong to
  // the shipped launch release, not to every subsequent release's notes.
  const launch = releases(p.data).find(r => r.version === '1.0.0');
  assert(launch, 'launch release missing');
  const notes = notesFor(launch);
  assertEquals(notes.split('\n').filter((l) => l.startsWith('- ')).length >= 10, true);
});

Deno.test('release: a PR description holds its Changelog lines, with their check; none, comments and bad lines', () => {
  const body = [
    '## Changelog',
    '<!-- Example:  Changelog (held): not this one -->',
    'Changelog (held): Tines reach the part.',
    '- changelog (Easy):  Docker starts without IPv6.  ',
    'Changelog (all): roll-ups are not a PR check',
    'Changelog: no check given',
    'Changelog (held): ',
    'The changelog: prose that merely mentions it',
  ].join('\r\n');
  const l = changelogLines(body);
  assertEquals(l.entries, [{ check: 'held', text: 'Tines reach the part.' }, { check: 'easy', text: 'Docker starts without IPv6.' }]);
  assertEquals(l.bad, ['Changelog (all): roll-ups are not a PR check', 'Changelog: no check given', 'Changelog (held):']);
  assert(!l.none);
  assert(changelogLines('text\nChangelog: none -- tests only').none);
  assertEquals(changelogLines(null), { entries: [], none: false, bad: [] });
});

Deno.test('release: collect takes PRs merged after the last release, oldest first, once each', () => {
  const data = { releases: [{ version: '1.0.0', date: '2026-11-01', entries: [entry('old', { pr: 5 })] }], unreleased: [entry('hand', { pr: 9 })] };
  const pr = (number, mergedAt, body, title = `pr ${number}`) => ({ number, mergedAt, body, title });
  const prs = [
    pr(12, '2026-11-03T09:00:00Z', 'Changelog (stays): later'),
    pr(11, '2026-11-02T09:00:00Z', 'Changelog (held): first\nChangelog (clean): second'),
    pr(4, '2026-11-01T08:00:00Z', 'Changelog (held): merged before the release'),
    pr(5, '2026-11-02T10:00:00Z', 'Changelog (held): already released'),
    pr(9, '2026-11-02T10:00:00Z', 'Changelog (held): already unreleased'),
    pr(13, '2026-11-02T11:00:00Z', 'no line', 'forgot'),
    pr(14, '2026-11-02T12:00:00Z', 'Changelog: none'),
    pr(15, '2026-11-02T13:00:00Z', 'Changelog: unchecked'),
    pr(16, null, 'Changelog (held): closed, never merged'),
  ];
  const out = collect(data, prs, '2026-11-01T12:00:00Z');
  assertEquals(out.entries, [
    { pr: 11, date: '2026-11-02', check: 'held', text: 'first' },
    { pr: 11, date: '2026-11-02', check: 'clean', text: 'second' },
    { pr: 12, date: '2026-11-03', check: 'stays', text: 'later' },
  ]);
  assertEquals(out.missing, [{ pr: 13, title: 'forgot' }]);
  assertEquals(out.bad, [{ pr: 15, line: 'Changelog: unchecked' }]);
  const again = collect({ ...data, unreleased: [...data.unreleased, ...out.entries] }, prs, '2026-11-01T12:00:00Z');
  assertEquals(again.entries, [], 'collecting twice adds nothing');
  // collected entries pass the changelog's own entry rules once stamped
  const p = prepare({ ...data, unreleased: out.entries }, '', '2026-11-04');
  assertEquals(releases(p.data)[0].entries.map((e) => e.pr), [11, 11, 12]);
});
