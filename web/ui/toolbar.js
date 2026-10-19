/**
 * The view toolbar: Undo/Redo and icon badges along the bottom of the 3D view, the
 * way a slicer keeps its view tools. Rotate, Suggest, Strength, Section (#250) and
 * View sit in it (local issue 42); each module registers its own badge -- nothing
 * here knows what a badge does.
 *
 * Two kinds of badge, one popover open at a time:
 *   - a tool badge (Section: `setOn` given) is a tool that is on or off. Click an
 *     off badge: the tool turns on and its popover opens. Opening another popover
 *     closes this one but the tool stays on (its badge stays lit) -- click the lit
 *     badge to bring its settings back; click it with its popover open to turn the
 *     tool off.
 *   - a panel badge (Rotate, Suggest, Strength, View: no `setOn`) only opens and
 *     folds its popover. `isOn` (optional) lights it while it holds a state worth
 *     seeing with the popover folded (Strength: a load is set).
 * A popover opens above its own badge, its left edge on the badge's, extending
 * right -- slid back left only as far as the window's edge needs. A click on the
 * 3D view leaves it open (Lay a face flat and Section are used there); Esc folds it
 * and hands focus back to its badge. `onFold` runs when a popover folds, for a mode
 * armed from inside it that must not stay armed out of sight (Lay a face flat).
 * The bar shows while a part is loaded (showToolbar, from part.js) and hides again
 * when Remove model takes it off, folding any open popover.
 *
 * It sits bottom-left, at the window's edge -- or just right of the stats card when
 * a short window has scrolled the card down beside it.
 */
import { el } from './dom.js';

const badges = new Map();        // id -> { btn, pop, isOn, setOn, onFold }
let openId = null;               // the badge whose popover is showing
let shownId = null;              // ...as of the last render, to catch a fold

function render() {
  if (shownId && shownId !== openId) badges.get(shownId).onFold?.();
  shownId = openId;
  for (const [id, b] of badges) {
    const on = b.isOn?.() ?? false;
    if (b.setOn && !on && openId === id) openId = null;
    b.btn.classList.toggle('on', on);
    if (b.setOn) b.btn.setAttribute('aria-pressed', String(on));
    b.btn.setAttribute('aria-expanded', String(openId === id));
    if (b.pop) b.pop.hidden = openId !== id;
  }
  place();
}

const GAP = 12, EDGE = 14;
/** Park the bar clear of the stats card, then the open popover above its badge. */
function place() {
  const bar = el('viewbar');
  if (bar.hidden) return;
  const b = bar.getBoundingClientRect();
  let left = EDGE;
  // The stats card, when a short window scrolls the rail down beside the bar.
  for (const card of el('left-rail').children) {
    const r = card.getBoundingClientRect();
    if (r.width && r.bottom > b.top && r.top < b.bottom) left = Math.max(left, r.right + GAP);
  }
  if (left + bar.offsetWidth > innerWidth - EDGE) left = EDGE;
  bar.style.left = `${left}px`;
  const open = openId && badges.get(openId);
  if (open?.pop) {
    const pop = open.pop;
    pop.style.left = '0px';
    const at = open.btn.offsetLeft - open.btn.parentElement.scrollLeft;
    const over = left + at + pop.offsetWidth - (innerWidth - EDGE);
    // never past the window's left edge either, when the bar sits right of the card
    pop.style.left = `${Math.max(EDGE - left, at - Math.max(0, over))}px`;
  }
}
addEventListener('resize', place);
const watch = new ResizeObserver(place);
watch.observe(el('stats'));
el('left-rail').addEventListener('scroll', place);
const row = document.querySelector('#viewbar .vb-badges');
row.addEventListener('scroll', place);
watch.observe(row);              // a language change resizes the badges

/**
 * Register a badge. `id` is its button in #viewbar; `pop` (optional) the id of its
 * popover there. A tool badge passes `isOn()` (reads the tool's state) and
 * `setOn(v)` (changes it); a panel badge passes neither, or only `isOn` to light
 * up. `onFold()` (optional) runs whenever its popover folds. Returns a sync() for
 * the module to call when that state changes.
 */
export function addBadge(id, { pop, isOn, setOn, onFold } = {}) {
  const b = { btn: el(id), pop: pop ? el(pop) : null, isOn, setOn, onFold };
  badges.set(id, b);
  if (pop) b.btn.setAttribute('aria-controls', pop);
  b.btn.addEventListener('click', () => {
    // a tool with nothing to fold out (Move) just turns on and off, any open
    // popover left as it is
    if (setOn && !b.pop) { setOn(!isOn()); render(); return; }
    if (!setOn) openId = openId === id ? null : id;
    else if (!isOn()) { setOn(true); openId = isOn() ? id : null; }
    else if (openId !== id) openId = id;
    else { setOn(false); openId = null; }
    render();
  });
  if (b.pop) watch.observe(b.pop);   // a list landing in it can widen it past the edge
  return render;
}

// Esc folds the open popover away; a tool stays on. Focus inside it goes back to
// its badge rather than dropping to the page.
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !openId) return;
  const b = badges.get(openId);
  const refocus = b.pop?.contains(document.activeElement);
  openId = null;
  render();
  if (refocus) b.btn.focus();
});

/** Show the bar (a part is loaded) or hide it. */
export function showToolbar(v) {
  el('viewbar').hidden = !v;
  if (!v && openId) { openId = null; render(); }
  place();
}
