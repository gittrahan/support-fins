import { assert, assertEquals, assertStringIncludes, assertThrows } from 'jsr:@std/assert';
import { carried, notesFor, pendingTags, prepare } from '../.github/scripts/release.js';
import { releases } from '../web/changelog.js';

const entry = (text, extra = {}) => ({ date: '2026-10-28', check: 'held', text, ...extra });
const main0 = { releases: [], unreleased: [entry('first', { summary: [{ check: 'easy', items: ['a plugin'] }] }), entry('second', { pr: 7 })] };

Deno.test('release: prepare stamps every unreleased entry under the next patch, or the version asked for', () => {
  const p = prepare(main0, '', '2026-10-28');
  assertEquals(p.version, '1.0.0');
  assertEquals(p.data.unreleased, []);
  assertEquals(releases(p.data)[0].entries.map((e) => e.text), ['first', 'second']);
  assertEquals(prepare({ ...p.data, unreleased: [entry('third')] }, '', '2026-10-29').version, '1.0.1');
  assertEquals(prepare({ ...p.data, unreleased: [entry('third')] }, '1.1.0', '2026-10-29').version, '1.1.0');
  assertEquals(prepare(p.data, '', '2026-10-29'), null, 'nothing waiting: no release PR');
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

Deno.test('release: a rebuilt release PR keeps a hand-picked version while it is still ahead', () => {
  const picked = prepare(main0, '1.1.0', '2026-10-28').data;
  assertEquals(carried(main0, picked), '1.1.0');
  assertEquals(carried(main0, null), '');
  assertEquals(carried(picked, picked), '', 'once released, it is no longer ahead');
});

Deno.test('release: notes list each entry with its PR, summaries by check, and never @mention', () => {
  const r = releases(prepare({ ...main0, unreleased: [...main0.unreleased, entry('thanks @someone')] }, '', '2026-10-28').data)[0];
  const notes = notesFor(r, 'o/r');
  assertStringIncludes(notes, '- second (https://github.com/o/r/pull/7)');
  assertStringIncludes(notes, '**Easy anywhere**\n- a plugin');
  assertStringIncludes(notes, 'ghcr.io/o/r:v1.0.0');
  assert(!/@someone/.test(notes) && notes.includes('@‍someone'));
});
