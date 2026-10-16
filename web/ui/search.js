/**
 * Settings search (local issue 42): a box at the top of the options panel that
 * narrows it to the settings whose name matches, opening the folded sections they
 * sit in, and puts the panel back as it was when cleared (Esc or the x).
 *
 * - A "row" is one setting: a field, a checkbox, Placement, or an action button.
 * - Names first: every word typed must appear in the row's name (as shown, and the
 *   English it was translated from). Only when no name matches does it fall back to
 *   the tooltips, so "gap" finds Support gap and Pad gap, not every tooltip that
 *   mentions a gap.
 * - A match the current mode hides (Brace depth with sway off, a pad number outside
 *   Custom) stays hidden -- no control the math ignores -- and the switch that
 *   reveals it is shown with it (GATES). Turn it on and the match appears.
 * - Sections opened for a search don't count as the user opening them: settings.js
 *   skips saving the open state while #fin-opts has .searching, and clearing puts
 *   each one back.
 * Layout only: it shows and hides rows, never changes a value.
 */
import { el } from './dom.js';
import { t } from './i18n.js';

const pane = el('fin-opts');
const box = el('opts-search');
const empty = el('opts-search-empty');

const ROWS = '.fld, label.check, button.btn:not([data-mode])';
const rows = () => [...pane.querySelectorAll(ROWS)].filter((r) => !r.closest('.opts-search')
  && !r.parentElement.closest(ROWS));      // a field's own inner label isn't a row of its own
// The row that reveals a hidden one, by the hidden row's id (or a selector).
const GATES = [
  ['#tinegrip-fld, #layerh-fld', () => el('tines').closest('label')],
  ['[data-pad-custom]', () => el('bed-pad').closest('label')],
  ['#sway-from-fld, #sway-spacing-fld, #sway-depth-fld, #full-brace-depth-fld', () => el('sway').closest('label')],
  ['#coverage-fld, #augment-toggle, #remove-fins-toggle, #restore-fins, #draw-controls button', () => el('fin-mode-fld')],
];

const fold = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// The name as shown plus the English it came from. A button whose label code rewrites
// (Remove fins, + Add walls by hand) keeps its English in data-search; Placement's
// note under the buttons is a description, not its name.
function nameOf(r) {
  const parts = [r.dataset.search ?? ''];
  const walk = (n) => {
    if (n.nodeType === 3) parts.push(n.textContent);
    else if (n.nodeType === 1 && !n.classList.contains('mode-note')) {
      if (n.dataset.origText) parts.push(n.dataset.origText);
      for (const c of n.childNodes) walk(c);
    }
  };
  walk(r);
  return fold(parts.join(' '));
}
const tipOf = (r) => fold(`${r.title} ${r.dataset.origTitle ?? ''}`);
const shown = (r) => !r.closest('[hidden]');

let saved = null;   // each section's open state from before the search
let gated = new Set(), gatedFor = '';   // the gates this query has shown

function clearMarks() {
  for (const n of pane.querySelectorAll('.hit, .nohit')) n.classList.remove('hit', 'nohit');
}

/** Re-run the current query (also after any change that hides or shows a row). */
export function runSearch() {
  const words = fold(box.value).split(/\s+/).filter(Boolean);
  clearMarks();
  if (!words.length) {
    if (saved) {
      for (const [d, open] of saved) d.open = open;
      saved = null;
    }
    gated = new Set(); gatedFor = '';
    pane.classList.remove('searching');
    empty.hidden = true;
    return;
  }
  if (!saved) saved = [...pane.querySelectorAll('details.sec')].map((d) => [d, d.open]);
  pane.classList.add('searching');

  const all = rows();
  const has = (text) => words.every((w) => text.includes(w));
  let hits = all.filter((r) => has(nameOf(r)));
  if (!hits.length) hits = all.filter((r) => has(tipOf(r)));
  const show = new Set(hits);
  if (box.value !== gatedFor) { gated = new Set(); gatedFor = box.value; }
  for (const r of hits) {
    const gate = GATES.find(([sel]) => r.matches(sel))?.[1]();
    if (gate && !shown(r)) gated.add(gate);
  }
  for (const g of gated) show.add(g);   // a gate stays once it revealed a match, to switch back off
  for (const r of show) r.classList.add('hit');

  // open what holds a match, hide what holds none
  for (const c of pane.querySelectorAll('.sec, .group, #draw-controls')) {
    const any = [...show].some((r) => c.contains(r) && shown(r));
    c.classList.toggle('nohit', !any);
    if (any && c.tagName === 'DETAILS') c.open = true;
  }
  empty.hidden = [...show].some(shown);
  empty.textContent = t('No settings match');
}

box.addEventListener('input', runSearch);
box.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && box.value) { e.stopPropagation(); box.value = ''; runSearch(); }
});
// A change can reveal a gated match (ticking Sway braces shows Brace depth).
pane.addEventListener('change', () => { if (box.value) runSearch(); });
window.addEventListener('languagechange', () => { if (box.value) runSearch(); });
