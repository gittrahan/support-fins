// A phone (style.css, max-width 600px): the stats card and the fin settings fold
// behind two chips under the top bar (#phone-chips), one open at a time. The chips
// follow the panels they stand for -- Part while a part is on the plate, Fin
// settings while fins are on -- and a tap on the view folds whichever is open, as
// the ☰ sheet does. On a wider window the chips are display:none and the body
// classes do nothing.
import { el } from './dom.js';

const chips = el('phone-chips');
const panels = { stats: el('chip-stats'), 'fin-opts': el('chip-opts') };
const cls = { stats: 'show-stats', 'fin-opts': 'show-opts' };

function show(id) {
  for (const [p, chip] of Object.entries(panels)) {
    const open = p === id;
    document.body.classList.toggle(cls[p], open);
    chip.setAttribute('aria-expanded', String(open));
  }
}
for (const [p, chip] of Object.entries(panels)) {
  chip.addEventListener('click', () => show(document.body.classList.contains(cls[p]) ? null : p));
}

function sync() {
  chips.hidden = el('stats').hidden;
  panels['fin-opts'].hidden = el('fin-opts').hidden;
  if (el('fin-opts').hidden && document.body.classList.contains(cls['fin-opts'])) show(null);
}
const watch = new MutationObserver(sync);
for (const id of Object.keys(panels)) watch.observe(el(id), { attributes: true, attributeFilter: ['hidden'] });
sync();

el('viewport').addEventListener('pointerdown', () => show(null));
// window capture runs before topbar.js's document capture: an Escape that folds
// the ☰ sheet or closes one of its menus doesn't fold these as well
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !document.querySelector('#topbar.more-open')) show(null);
}, true);

// The plate tabs sit right of the chips; when the chips' words leave them too
// little room (a long language), they drop to a row of their own under the chips.
const ROOM = 150;
function roomForPlates() {
  const w = chips.hidden ? 0 : chips.getBoundingClientRect().width;
  document.body.classList.toggle('plates-below', !chips.hidden && innerWidth - 28 - 8 - w < ROOM);
}
new ResizeObserver(roomForPlates).observe(chips);
addEventListener('resize', roomForPlates);
