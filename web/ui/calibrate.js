// Calibrate menu: the topbar's download list of test prints, one per setting.
//
// Laid out like the Plugins menu (and styled by its classes): one collapsible row
// per coupon, its print time and filament where a plugin shows its version, and a
// Download button. The files are copies of prototype/calibration/<name>/print/,
// served from web/calibration/; prototype/calibration/estimate.py refreshes them and
// slices each for web/calibration/coupons.json (the estimates and the profile they
// came from), fetched the first time the menu opens and left out if it fails.
// What to read off each print is docs/CALIBRATION.md; the rows give the short form.
import { el } from './dom.js';
import { t } from './i18n.js';

const DIR = 'calibration/';
const GUIDE = 'https://github.com/gittrahan/support-fins/blob/main/docs/CALIBRATION.md';

// Menu order = print order: angle first, since it decides which faces get support.
export const COUPONS = [
  {
    name: 'Angle', file: 'angle-coupon.stl',
    sets: 'Sets the Overhang slider (top bar) · print this first',
    note: 'No supports in this one: print it as it is.',
    how: 'Seven ramps, 10° to 40°, measured up from the plate, so lower is harder. The shallowest ramp that came out clean (no droop, no curls) is your Overhang setting. The slider stops at 30°: if a lower ramp came out clean, set 30.',
  },
  {
    name: 'Gap', file: 'gap-coupon.3mf',
    sets: 'Sets Clearances ▸ Support gap',
    note: 'Print at 0.2 mm layers with a 0.2 mm first layer and adaptive layer height off, or the gaps stop being whole layers.',
    how: 'Ledges held 0.2, 0.4 and 0.6 mm below (1, 2 and 3 empty layers). Snap each wall off. Welded or tearing the ledge = too small; saggy or stringy underside = too big. Use the smallest gap that snaps off clean. The field stops at 0.4: if only 0.6 came clean, set 0.4 and tell us.',
  },
  {
    name: 'Grip', file: 'grip-coupon.3mf',
    sets: 'Sets Tines ▸ Tine grip',
    how: 'Four ramps built at OFF, LIGHT (the default), MID and FIRM. Check every wall is still standing, then snap them off. A wall leaned or came loose: go one step right. Marks where the tines were: go one step left. Use the lightest setting whose walls all held.',
  },
  {
    name: 'Pad', file: 'pad-coupon.3mf',
    sets: 'Sets Clearances ▸ Bed pad ▸ Custom ▸ Pad gap',
    how: 'One bar on three knife-edge feet, each held down only by its own pad, 0 to 0.2 mm off it. A foot lifted at its corner = gap too big; a pad won\'t peel or tears the edge = too small. Use the biggest gap whose foot stayed down, with Pad thickness 0.2, Pad grip 0 and Pad spread 4.',
  },
  {
    name: 'Cutouts', file: 'cutout-coupon.3mf',
    sets: 'Sets Walls ▸ Cutouts',
    how: 'Five tall ledges, each held by walls cut with one style: NONE, DIAMOND, TRIANGLE, ARCH, LATTICE. Check every wall stood and every ledge printed flat, then snap the walls off. A wall that leaned, sagged at a hole or broke apart: that style is too open. Use the most open style whose walls all held; Arch and Lattice save about a third of the support plastic.',
  },
  {
    name: 'Bore', file: 'bore-coupon.3mf',
    sets: 'No setting yet: tells us how small a hole to support',
    how: 'A block with two sets of sideways holes, 3 to 12 mm across. In set A one wall runs along each hole, the way the site does it; in set X three walls run across it. Pull every wall out of an open end (an X wall slides out along the hole) and tell us which came out clean, which broke or stuck, and whether A or X left the smoother ceiling.',
  },
  {
    name: 'Sampler', file: 'sampler-coupon.3mf',
    sets: 'Sets nothing: print it last, to see what your parts will get',
    note: 'Part and supports are two objects: don\'t Arrange or move one without the other.',
    how: 'One part with every hard shape: ramps, a ball, a thin ledge, a flat table, a mushroom, a cave, sideways holes and an arch, supported in Full coverage. Snap every wall off and tell us which stuck or tore the part, and which undersides sagged. A few droopy layers on the ball and a rougher table near the spine are what we get too.',
  },
];

// 19 -> "19 min", 62 -> "1 h 2 min"
export function fmtTime(min) {
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;
}

const btn = el('calibrate');
const panel = el('calibrate-menu');
const list = el('calibrate-list');
let est = null;      // coupons.json, once fetched

function render() {
  const wasOpen = new Set([...list.querySelectorAll('details[open]')].map((d) => d.dataset.name));
  list.replaceChildren(...COUPONS.map((c) => {
    const row = document.createElement('details');
    row.className = 'plugin';
    row.dataset.name = c.name;
    row.open = wasOpen.has(c.name);
    const head = document.createElement('summary');
    head.className = 'plugin-head';
    const title = document.createElement('span');
    title.className = 'plugin-name';
    const name = document.createElement('b');
    name.textContent = t(c.name);
    title.append(name);
    const e = est?.coupons?.[c.file];
    if (e) {
      const v = document.createElement('span');
      v.className = 'plugin-v';
      v.textContent = ` · ${fmtTime(e.minutes)} · ${Math.round(e.grams)} g`;
      title.append(v);
    }
    const go = document.createElement('a');
    go.className = 'btn sm';
    go.href = DIR + c.file;
    go.download = c.file;
    go.textContent = t('Download');
    go.title = c.file;
    head.append(title, go);
    const body = document.createElement('div');
    body.className = 'plugin-body';
    const sets = document.createElement('div');
    sets.className = 'plugin-needs';
    sets.textContent = t(c.sets);
    body.append(sets);
    if (c.note) {
      const note = document.createElement('div');
      note.className = 'plugin-note';
      note.textContent = t(c.note);
      body.append(note);
    }
    const how = document.createElement('div');
    how.className = 'plugin-how';
    how.textContent = t(c.how);
    body.append(how);
    row.append(head, body);
    return row;
  }));
  el('calibrate-profile').textContent = est?.profile
    ? t('Times and filament from {profile}; yours will differ.', { profile: est.profile }) : '';
}

async function fetchEstimates() {
  if (est) return;
  est = {};
  try {
    const res = await fetch(DIR + 'coupons.json');
    if (!res.ok) return;
    est = await res.json();
    render();
  } catch { /* offline: the downloads still work, just without estimates */ }
}

function setOpen(open) {
  panel.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  if (open) {
    // the menus close each other on pointerdown only; a keyboard open must too
    for (const [b, m] of [['export', 'export-menu'], ['plugins', 'plugins-menu']]) {
      el(m).hidden = true;
      el(b).setAttribute('aria-expanded', 'false');
    }
    fetchEstimates();
    list.querySelector('summary')?.focus();
  }
}

el('calibrate-guide').href = GUIDE;
render();

btn.addEventListener('click', () => setOpen(panel.hidden));
for (const other of ['export', 'plugins']) {
  el(other).addEventListener('click', () => { if (!panel.hidden) setOpen(false); });
}
// click-away / Esc close it, like the other menus
document.addEventListener('pointerdown', (e) => {
  if (!panel.hidden && !e.target.closest('.calibrate-wrap')) setOpen(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !panel.hidden) { setOpen(false); btn.focus(); }
});
