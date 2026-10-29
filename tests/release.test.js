import { assert, assertEquals, assertStringIncludes, assertThrows } from 'jsr:@std/assert';
import { notesFor, pendingTags, prepare } from '../.github/scripts/release.js';
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
  const notes = notesFor(releases(p.data)[0]);
  assertEquals(notes.split('\n').filter((l) => l.startsWith('- ')).length >= 10, true);
});
