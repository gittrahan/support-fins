/**
 * The view toolbar: icon badges along the bottom of the 3D view, the way a slicer
 * keeps its view tools. Section (#250) is the first; more view tools join it
 * (local issue 42) by calling addBadge -- nothing here knows what a badge does.
 *
 * A badge is a tool that is on or off, with a popover of its key settings:
 *   - click an off badge: the tool turns on and its popover opens;
 *   - one popover at a time: opening another closes it, but the tool stays on
 *     (its badge stays lit) -- click the lit badge to bring its settings back;
 *   - click the badge whose popover is open: the tool turns off.
 * The bar shows once a part is loaded (showToolbar, from part.js); nothing
 * unloads a part, so it is never hidden again. Esc folds the open popover.
 *
 * It sits bottom-left, badges filling in from the left, just right of the
 * rotate panel (#orient) -- or at the window's edge when there is no room there
 * (a phone, where the panels stack) or no panel.
 */
import { el } from './dom.js';

const badges = new Map();        // id -> { btn, pop, isOn, setOn }
let openId = null;               // the badge whose popover is showing

function render() {
  for (const [id, b] of badges) {
    const on = b.isOn();
    if (!on && openId === id) openId = null;
    b.btn.classList.toggle('on', on);
    b.btn.setAttribute('aria-pressed', String(on));
    b.btn.setAttribute('aria-expanded', String(openId === id));
    if (b.pop) b.pop.hidden = openId !== id;
  }
  place();
}

const GAP = 12, EDGE = 14;
/** Park the bar just right of the rotate panel, if it fits there. */
function place() {
  const bar = el('viewbar');
  if (bar.hidden) return;
  const o = el('orient').getBoundingClientRect();
  let left = o.width ? o.right + GAP : EDGE;
  if (left + bar.offsetWidth > innerWidth - EDGE) left = EDGE;
  bar.style.left = `${left}px`;
}
addEventListener('resize', place);
new ResizeObserver(place).observe(el('orient'));

/**
 * Register a badge. `id` is its button in #viewbar; `pop` (optional) the id of its
 * popover there. `isOn()` reads the tool's state, `setOn(v)` changes it. Returns a
 * sync() for the tool to call when it switches itself on or off.
 */
export function addBadge(id, { pop, isOn, setOn }) {
  const b = { btn: el(id), pop: pop ? el(pop) : null, isOn, setOn };
  badges.set(id, b);
  if (pop) b.btn.setAttribute('aria-controls', pop);
  b.btn.addEventListener('click', () => {
    if (!isOn()) { setOn(true); openId = isOn() ? id : null; }
    else if (openId !== id) openId = id;
    else { setOn(false); openId = null; }
    render();
  });
  return render;
}

// Esc folds the open popover away; the tool stays on.
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openId) { openId = null; render(); }
});

/** Show the bar (a part is loaded) or hide it. */
export function showToolbar(v) {
  el('viewbar').hidden = !v;
  place();
}
