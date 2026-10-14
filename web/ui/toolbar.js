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
 * The bar shows once a part is loaded (showToolbar, from part.js).
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
}

/**
 * Register a badge. `id` is its button in #viewbar; `pop` (optional) the id of its
 * popover there. `isOn()` reads the tool's state, `setOn(v)` changes it. Returns a
 * sync() for the tool to call when it switches itself on or off.
 */
export function addBadge(id, { pop, isOn, setOn }) {
  const b = { btn: el(id), pop: pop ? el(pop) : null, isOn, setOn };
  badges.set(id, b);
  b.btn.addEventListener('click', () => {
    if (!isOn()) { setOn(true); openId = isOn() ? id : null; }
    else if (openId !== id) openId = id;
    else { setOn(false); openId = null; }
    render();
  });
  return render;
}

/** Show the bar (a part is loaded) or hide it. */
export function showToolbar(v) {
  el('viewbar').hidden = !v;
}
