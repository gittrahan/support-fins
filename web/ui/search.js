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
// The row that reveals a hidden one, by the hidden row's selector; null when no
// switch here would (Remove selected waits on a wall being picked).
const GATES = [
  ['#tinegrip-fld, #layerh-fld', () => el('tines').closest('label')],
  ['[data-pad-custom]', () => el('bed-pad').closest('label')],
  // the brace tine fields also hide with Tines off (settings.js syncSway)
  ['#sway-from-fld, #sway-spacing-fld', () => el(el('sway').checked ? 'tines' : 'sway').closest('label')],
  ['#sway-depth-fld, #full-brace-depth-fld', () => el('sway').closest('label')],
  ['#tall-ribs-height-fld', () => el('tall-ribs').closest('label')],
  ['#sway-cross-height-fld', () => el(el('sway').checked ? 'tall-ribs' : 'sway').closest('label')],
  ['#coverage-fld, #augment-toggle, #remove-fins-toggle', () => el('fin-mode-fld')],
  ['#restore-fins', () => el('remove-fins-toggle')],   // shows once a fin is removed
  ['#draw-clear', () => (el('fin-mode').value === 'draw' ? null : el('fin-mode-fld'))],
];

const fold = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// The name as shown plus the English it came from. A button whose label code rewrites
// (Remove fins, + Add walls by hand) keeps its English in data-search; Placement's
// note under the buttons is a description, not its name, and its hidden <select>
// isn't shown at all.
function nameOf(r) {
  const parts = [r.dataset.search ?? ''];
  const walk = (n) => {
    if (n.nodeType === 3) parts.push(n.textContent);
    else if (n.nodeType === 1 && !n.hidden && !n.classList.contains('mode-note')) {   // not the hidden #fin-mode
      if (n.dataset.origText) parts.push(n.dataset.origText);
      for (const c of n.childNodes) walk(c);
    }
  };
  for (const c of r.childNodes) walk(c);   // the row itself may be hidden: that's the gate's job
  if (r.dataset.origText) parts.push(r.dataset.origText);
  return fold(parts.join(' '));
}
// a title parked by ui/tips.js while its card is up is still its title
const tipOf = (r) => fold(`${r.title || r.dataset.tipTitle || ''} ${r.dataset.origTitle ?? ''}`);
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
  const none = ![...show].some(shown);
  if (empty.hidden === none) empty.hidden = !none;   // only on a change: the observer below watches it
  empty.textContent = none ? t('No settings match') : '';
}

box.addEventListener('input', runSearch);
box.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && box.value) { e.stopPropagation(); box.value = ''; runSearch(); }
});
// Anything that shows or hides a row re-runs the query: ticking Sway braces reveals
// Brace depth, an undo puts back a mode without firing a change, a build shows
// Remove fins. Batched to the next frame; search.js itself never sets `hidden` on a row.
let queued = false;
new MutationObserver((records) => {
  if (!box.value || queued || records.every((r) => r.target === empty)) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; runSearch(); });
}).observe(pane, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
window.addEventListener('languagechange', () => { if (box.value) runSearch(); });
