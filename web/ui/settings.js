import { t } from './i18n.js';
/**
 * The options panel: support mode, the fins / "+ Add" toggles, bed pad style,
 * tines, sway braces, gap, cutouts, material profile, and the collapsible
 * sections with their one-line recaps. Owns finsVisible / finMode / drawAugment.
 */
import { applyTunables, FIN, PAD } from '../fins.js';
import { BRACE, PROP } from '../prop.js';
import { CUT } from '../cutout.js';
import { MATERIAL } from '../materials.js';
import { applyNozzle, applyWallLines, wallLinesFit } from '../nozzle.js';
import { el } from './dom.js';
import { histPush } from './history.js';
import { removeMode, syncRemoveUI, cancelRemove } from './remove.js';
import { setDrawMsg, clearPreview, syncDrawControls } from './walls.js';
import { lastBuilt, refreshFins } from './finbuild.js';
import { setGizmo } from './pose.js';
import { paintOverhangs } from './part.js';
import { syncMore } from './more.js';

export let finsVisible = false;
export function setFinsVisible(v) { finsVisible = v; }
// The wall is the default support and the fin is the Brace OPTION, not the
// other way around -- flipped at M5c. Measured over the dev matrix, the fin
// covers 4% of overhang area (it braces against toppling; it holds nothing up)
// and 7 of its 12 placements lean 25-40deg. The wall covers 61%, always
// vertical. A user who loads a part and exports should get the support that
// supports.
//
// DEFAULT IS 'auto': click "Add fins" and the tool places the supports for you
// (tined combined fins on the grippable overhangs, plain props on the rest). Draw
// is the by-hand path. ('prop' still exists internally -- Draw calls it for the
// bed pad + seating verdict, and it is the geometry Auto props with.)
export let finMode = 'auto';
export function setFinMode(v) { finMode = v; }
// FULL COVERAGE ('full', fins/fill.js) is Auto plus walls under the red Auto left
// bare, so everything Auto offers -- the coverage slider, sway braces, per-fin
// removal, walls added by hand -- applies to it too. Every Auto-only gate asks this.
export const autoLike = (m = finMode) => m === 'auto' || m === 'full';
// Wide-face coverage is Auto's row density. Draw has no rows, so it is hidden there;
// Full coverage holds every overhang it can reach whatever the slider says, so there
// it shows but is disabled (finbuild.js sends the neutral default instead).
const COVER_TIP_FULL = 'Full coverage supports every overhang a wall can reach, so this '
  + 'slider only applies in Auto.';
let coverTip = null;
export function syncCoverageUI() {
  const fld = el('coverage-fld'), full = finMode === 'full';
  coverTip ??= (fld.dataset.origTitle ??= fld.title);
  fld.hidden = !autoLike();
  el('coverage').disabled = full;
  fld.classList.toggle('disabled', full);
  fld.title = t(full ? COVER_TIP_FULL : coverTip);
  el('long-walls-fld').hidden = !full;   // Full coverage's own (fins/rows.js)
  // only the fill pass joins walls (#309): Full's, and Auto's under Curved walls
  el('separate-walls-fld').hidden = !(full || (autoLike() && el('curved-walls').checked));
  el('curved-walls-fld').hidden = !autoLike();   // Draw lays its own lines
  syncMore();   // coverage counts as changed only while the build reads it
}
// Suggest + Draw mix: when true, the pointer places hand-drawn walls ON TOP of the
// auto-placed ones (for when auto misses a spot). It only gates the pointer; the
// drawn walls themselves stay shown/exported after placing until Clear all.
export let drawAugment = false;
export function setDrawAugment(v) { drawAugment = v; }
/** The "+ Add walls by hand" toggle, shown only in Suggest mode. */
export function syncAugmentUI() {
  const show = finsVisible && autoLike();
  el('augment-toggle').hidden = !show;
  el('augment-toggle').classList.toggle('primary', drawAugment);
  el('augment-toggle').textContent = drawAugment ? t('Done adding walls') : t('+ Add walls by hand');
}

// The Placement buttons drive the hidden #fin-mode select (the one place the mode
// is kept) and follow it; history.js calls syncModeButtons after an undo sets it.
const MODE_NOTES = {
  auto: 'Places supports for you.',
  full: 'Auto, plus walls under every overhang it leaves bare. More plastic.',
  draw: 'You place each wall: click two points across an overhang.',
};
export function syncModeButtons() {
  const v = el('fin-mode').value;
  for (const b of document.querySelectorAll('#fin-mode-fld [data-mode]')) {
    b.setAttribute('aria-pressed', String(b.dataset.mode === v));
  }
  el('fin-mode-note').textContent = t(MODE_NOTES[v] ?? '');
}
for (const b of document.querySelectorAll('#fin-mode-fld [data-mode]')) {
  b.addEventListener('click', () => {
    const sel = el('fin-mode');
    if (sel.value === b.dataset.mode) return;
    sel.value = b.dataset.mode;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
syncModeButtons();
window.addEventListener('languagechange', syncModeButtons);

el('fin-mode').addEventListener('change', (e) => {
  histPush();
  finMode = e.target.value;
  syncModeButtons();
  syncCoverageUI();
  drawAugment = false;      // start each mode with hand-placement off
  if (removeMode) cancelRemove();
  setDrawMsg('');
  clearPreview();
  syncAugmentUI();
  syncDrawControls();
  syncRemoveUI();
  setGizmo();
  refreshFins();
});
// Bed pad style (PAD.style in fins/pad.js). Only Custom shows the pad's numbers; the
// presets keep theirs fixed (Sure hold's are FIN.padH and PAD.grab). Switching
// to Custom starts it from whichever preset was showing, so a tweak begins from
// numbers that are known to print rather than from blanks.
const PAD_FIELDS = { h: 'pad-h', gap: 'pad-gap', grip: 'pad-grip', margin: 'pad-margin' };
function padPreset(style) {
  // Auto starts Custom from whatever it last built.
  if (style === 'auto') style = lastBuilt?.pad?.style === 'sure' ? 'sure' : 'light';
  return style === 'sure'
    ? { h: FIN.padH, gap: 0, grip: PAD.grab, margin: FIN.padMargin }
    : { h: el('layer-height').valueAsNumber || 0.2, gap: PAD.brimGap, grip: 0, margin: FIN.padMargin };
}
let padShown = el('bed-pad').value;
function syncPadStyle() {
  const v = el('bed-pad').value;
  if (v === 'custom' && padShown !== 'custom') {
    const p = padPreset(padShown);
    for (const [k, id] of Object.entries(PAD_FIELDS)) el(id).value = +p[k].toFixed(2);
    readPadCustom();
  }
  if (v !== 'off') PAD.style = v;
  padShown = v;
  for (const f of document.querySelectorAll('[data-pad-custom]')) f.hidden = v !== 'custom';
  syncTineGrip();
  syncSectionSums();
}
function readPadCustom() {
  for (const [k, id] of Object.entries(PAD_FIELDS)) {
    const input = el(id), v = input.valueAsNumber;
    if (Number.isFinite(v)) PAD.custom[k] = Math.min(+input.max, Math.max(+input.min, v));
  }
}
el('bed-pad').addEventListener('change', () => { syncPadStyle(); refreshFins(); });
for (const id of Object.values(PAD_FIELDS)) {
  el(id).addEventListener('input', () => { readPadCustom(); debouncedRefresh(); });
}
// A slider fires `input` on every pixel of a drag; on a big part one regenerate can
// take a while, so re-running it per tick freezes the page mid-drag. Coalesce the
// drag into a single rebuild once the value settles. `change` (fires on release) is
// too coarse -- no live preview at all -- so debounce instead: quick enough to feel
// live on a small part, one rebuild instead of dozens on a large one.
let refreshTimer = null;
function debouncedRefresh(ms = 180) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => { refreshTimer = null; refreshFins(); }, ms);
}
// Tine grip only means anything when the tines are on, so hide its slider with the
// toggle (keeps the panel honest -- no dead control).
// Tine grip + layer height only matter when Tines is on -- hide both otherwise.
// With vertical (resin) pins the slider only spaces the pins, so it says that there
// (#309: "not sure what light vs tight grip are changing"). More pins is the way to
// hold harder: resin slicers sink a tip 0-0.2 mm, and a deeper pin scars more.
const PIN_SPACING_TIP = 'How many pins each wall gets. More pins = a firmer hold; fewer = fewer '
  + 'marks to clean up. Add pins before deepening them: a deeper pin leaves a bigger mark and '
  + 'is harder to snap off.';
let gripTip = null;
function syncTineGrip() {
  const on = el('tines').checked;
  el('tinegrip-fld').hidden = !on;
  el('tinedir-fld').hidden = !on;
  const pins = on && el('tine-dir').value === 'vertical';
  const grip = el('tinegrip-fld');
  gripTip ??= (grip.dataset.origTitle ??= grip.title);
  grip.querySelector('.grip-tines').hidden = pins;
  grip.querySelector('.grip-pins').hidden = !pins;
  grip.title = t(pins ? PIN_SPACING_TIP : gripTip);
  grip.dataset.tipPic = pins ? 'pin-spacing' : 'tine-density';
  el('pindepth-fld').hidden = !pins;
  el('resin-note').hidden = !pins;
  // The Light pad is one layer tall, and the interface band is one layer of the
  // wall top (prop/crest.js), so both read the layer height too.
  // Resin pins are no layer tall, so vertical tines don't need it either.
  el('layerh-fld').hidden = (!on || pins) && !['light', 'auto'].includes(el('bed-pad').value)
    && el('iface').value === 'off';
}
el('tines').addEventListener('change', () => { syncTineGrip(); refreshFins(); });
window.addEventListener('languagechange', syncTineGrip);   // the swapped tooltip, retranslated
// Tine direction (GitHub #309): vertical lays resin pins (prop/pins.js). This page's
// copy is set here for Draw; the Worker gets it in the build's tunables.
export function tineDirTunables() {
  return { tineDir: el('tine-dir').value, pinDepth: el('pin-depth').valueAsNumber };
}
// Resin cures joined walls into one block (#309), so picking a direction sets
// Separate walls to match; the box is the user's to change after.
el('tine-dir').addEventListener('change', (e) => {
  if (e.isTrusted) el('separate-walls').checked = el('tine-dir').value === 'vertical';
  applyTunables(tineDirTunables()); syncTineGrip(); refreshFins();
});
el('pin-depth').addEventListener('input', () => { applyTunables(tineDirTunables()); debouncedRefresh(); });
el('tine-density').addEventListener('input', () => debouncedRefresh());
el('layer-height').addEventListener('input', () => debouncedRefresh());
el('coverage').addEventListener('input', () => debouncedRefresh());

// Sway braces: the switch sits in its section header (like Tines), and its three
// settings only show while it is on, so an unused feature costs one line. The two
// tine settings additionally follow the global Tines toggle -- with tines off there
// is no comb to space.
function syncSway() {
  const on = el('sway').checked;
  el('sway-from-fld').hidden = !on || !el('tines').checked;
  el('sway-spacing-fld').hidden = !on || !el('tines').checked;
  el('sway-depth-fld').hidden = !on;
  el('full-brace-depth-fld').hidden = !on;
  el('sway-cross-height-fld').hidden = !on || !el('tall-ribs').checked;
  syncDrawControls();
  syncSectionSums();
}
el('sway').addEventListener('change', () => {
  syncSway();
  refreshFins();
});
el('tines').addEventListener('change', syncSway);
el('full-brace-depth').addEventListener('change', () => refreshFins());
for (const id of ['sway-from', 'sway-spacing', 'sway-depth', 'sway-cross-height']) {
  el(id).addEventListener('input', () => debouncedRefresh());
}
el('sway-cross-height').addEventListener('change', () => {
  const input = el('sway-cross-height'), v = input.valueAsNumber;
  input.value = String(Number.isFinite(v) ? Math.max(+input.min, Math.min(+input.max, v)) : 50);
  debouncedRefresh();
});
el('tall-ribs').addEventListener('change', syncSway);

// Gap tuning. PROP.gap / PAD.grab are read fresh on every build, so setting them
// here and rebuilding is all it takes. Clamp to the input's own range so a typed
// value can't drive the support into the part or float it off the overhang.
function wireGap(id, obj, key, lo, hi) {
  const input = el(id);
  input.addEventListener('input', () => {
    const v = input.valueAsNumber;
    if (Number.isFinite(v)) { obj[key] = Math.min(hi, Math.max(lo, v)); debouncedRefresh(); }
  });
}
wireGap('gap', PROP, 'gap', 0.1, 0.4);

// Wall cutouts (issue #34). CUT.pattern is read fresh by every wall sweep -- the
// drawn walls here on the page, the auto walls in the Worker via tunables.
el('cutout').addEventListener('change', () => {
  CUT.pattern = el('cutout').value;
  refreshFins();
});
// Plate only (#218): read by every build, auto in the Worker and drawn on the page.
el('plate-only').addEventListener('change', () => refreshFins());
// Long walls: Full coverage's rows (fins/rows.js), read by the build in the Worker.
el('long-walls').addEventListener('change', () => refreshFins());
el('separate-walls').addEventListener('change', () => refreshFins());
// Brace tall walls: Auto's in the Worker (fins/tall.js), drawn ones on the page.
function syncTallRibs() {
  el('tall-ribs-height-fld').hidden = !el('tall-ribs').checked;
  const input = el('tall-ribs-height'), v = input.valueAsNumber;
  if (Number.isFinite(v)) BRACE.tallH = Math.min(+input.max, Math.max(+input.min, v)) * 10;
}
el('tall-ribs').addEventListener('change', () => { syncTallRibs(); refreshFins(); });
el('tall-ribs-height').addEventListener('input', () => { syncTallRibs(); debouncedRefresh(); });
el('tall-ribs-height').addEventListener('change', () => {
  syncTallRibs();
  el('tall-ribs-height').value = String(BRACE.tallH / 10);
  debouncedRefresh();
});
// Curved walls (#25): read by Auto's build in the Worker (finbuild.js finOpts).
el('curved-walls').addEventListener('change', () => { syncCoverageUI(); refreshFins(); });

// Interface material (GitHub #21): a wall's top band becomes its own solid, exported
// as a part of the supports in the 3MF -- under flat contacts, or everywhere (tines
// too). PROP.iface is read fresh by every wall sweep -- the drawn walls here, the
// auto walls in the Worker via tunables.
const ifaceMode = () => ({ flat: 'flat', all: 'all' })[el('iface').value] ?? false;
el('iface').addEventListener('change', () => {
  PROP.iface = ifaceMode();
  syncTineGrip();
  refreshFins();
});

// The grams receipt's filament density: PLA's (../materials.js). The PLA/PETG
// dropdown is gone -- PETG's wider gap is the Support gap field's to set.
export const materialDensity = MATERIAL.pla.density;

// Nozzle size scales the support widths (../nozzle.js); this page's copy is set
// here for Draw, and the Worker gets it in the build's tunables. It is the
// printer's, like the build volume: remembered across visits (storage optional),
// and a saved session leaves it alone (history.js).
const NOZZLE_KEY = 'sf.nozzle';
try {
  const saved = localStorage.getItem(NOZZLE_KEY);
  if ([...el('nozzle').options].some((o) => o.value === saved)) el('nozzle').value = saved;
} catch { /* storage off */ }
el('nozzle').addEventListener('change', () => {
  applyNozzle(Number(el('nozzle').value));
  fitWallLines();
  try { localStorage.setItem(NOZZLE_KEY, el('nozzle').value); } catch { /* storage off */ }
  syncSectionSums();
  debouncedRefresh();
});

// Layer height and Support gap are remembered across visits too (local issue 42): you
// slice at one layer height and tune one gap for your machine, so a new part starts
// from your last ones. Unlike the nozzle, a saved session still restores its own
// (history.js). Read back before initSettings, which hands the gap to PROP.
const PRINTER_KEYS = { 'layer-height': 'sf.layerHeight', gap: 'sf.gap' };
for (const [id, key] of Object.entries(PRINTER_KEYS)) {
  const f = el(id);
  try {
    const v = Number(localStorage.getItem(key) ?? NaN);
    if (Number.isFinite(v) && v >= Number(f.min) && v <= Number(f.max)) f.value = String(v);
  } catch { /* storage off */ }
  f.addEventListener('change', () => {
    if (!Number.isFinite(f.valueAsNumber)) return;
    try { localStorage.setItem(key, f.value); } catch { /* storage off */ }
  });
}

// Wall lines thicken the walls, wedges and braces (../nozzle.js). A setting of this
// part, unlike the nozzle: undoable and saved with a session.
// A big nozzle offers only the line counts whose wall stays under TH_MAX (nozzle.js):
// wider would fuse a row of walls into one block. A count it can't take (a session
// saved at 8 lines, opened under a 2.0 nozzle) drops to the widest that fits.
function fitWallLines() {
  const f = el('wall-lines');
  for (const o of f.options) o.disabled = !wallLinesFit(Number(o.value));
  if (f.selectedOptions[0]?.disabled) {
    f.value = [...f.options].filter((o) => !o.disabled).pop().value;
    applyWallLines(Number(f.value));
  }
}
el('wall-lines').addEventListener('change', () => {
  applyWallLines(Number(el('wall-lines').value));
  fitWallLines();
  syncSectionSums();
  debouncedRefresh();
});

/** The fins-toggle button's appearance for the current finsVisible. Factored out
 *  so undo/redo can re-sync it after restoring the flag. */
export function syncFinsToggleUI() {
  el('fins-toggle').classList.toggle('primary', finsVisible);
  el('fins-toggle').textContent = finsVisible ? t('Fins on') : t('Add fins');
  el('fin-opts').hidden = !finsVisible;
  syncSectionSums();
}

// ------------------------------------------------------------ options sections
//
// The options panel is grouped into <details> sections (issue #41). Two jobs here:
// remember which are open, and write each section's one-line recap so collapsing
// it never hides what's set. Storage is a convenience only -- private windows and
// blocked storage throw, and the panel then just opens in its default layout.
const SEC_KEY = 'sf.sections';
function loadSectionState() {
  try { return JSON.parse(localStorage.getItem(SEC_KEY)) || {}; } catch { return {}; }
}
{
  const saved = loadSectionState();
  for (const d of document.querySelectorAll('#fin-opts details.sec')) {
    if (d.dataset.sec in saved) d.open = !!saved[d.dataset.sec];
    d.addEventListener('toggle', () => {
      if (el('fin-opts').classList.contains('searching')) return;   // opened by a search (search.js)
      const state = loadSectionState();
      state[d.dataset.sec] = d.open;
      try { localStorage.setItem(SEC_KEY, JSON.stringify(state)); } catch { /* storage off */ }
    });
  }
}
// The Tines switch sits inside its section's <summary>; without this a click on it
// would also fold the section open or shut.
el('tines').closest('label').addEventListener('click', (e) => e.stopPropagation());

// Display: amber highlight + over-warn card for the slivers too small for a fin.
// On by default; the choice is remembered (storage optional, like the sections).
// Display only: repaints the part, never rebuilds the fins.
const SMALL_KEY = 'sf.highlightSmall';
export let highlightSmall = true;
try { highlightSmall = localStorage.getItem(SMALL_KEY) !== '0'; } catch { /* storage off */ }
el('highlight-small').checked = highlightSmall;
el('highlight-small').addEventListener('change', (e) => {
  highlightSmall = e.target.checked;
  try { localStorage.setItem(SMALL_KEY, highlightSmall ? '1' : '0'); } catch { /* storage off */ }
  paintOverhangs();
});

/** Refill each section's collapsed recap, and More settings' changed count, from
 *  the controls' current values. */
export function syncSectionSums() {
  // The printer line names only what the build reads: layer height drops out
  // while it's hidden (tines off, a pad that doesn't read it).
  el('sum-printer').textContent = [
    `${el('nozzle').value} ${t('nozzle')}`,
    el('layerh-fld').hidden ? null : `${el('layer-height').value} ${t('layers')}`,
    `${el('gap').value} ${t('gap')}`,
    el('iface').value === 'off' ? null : t('interface'),
  ].filter(Boolean).join(' · ');
  const grip = el('tine-density').valueAsNumber;
  el('sum-tines').textContent = !el('tines').checked ? t('off')
    : el('tine-dir').value === 'vertical'
      ? `${t(grip <= 20 ? 'fewer pins' : grip >= 80 ? 'more pins' : 'pins')} · ${t('resin')}`
      : t(grip <= 20 ? 'light grip' : grip >= 80 ? 'firm grip' : 'medium grip');
  syncMore();
}
el('fin-opts').addEventListener('input', syncSectionSums);
el('fin-opts').addEventListener('change', syncSectionSums);

el('fins-toggle').addEventListener('click', () => {
  histPush();
  finsVisible = !finsVisible;
  if (!finsVisible) drawAugment = false;
  if (removeMode) cancelRemove();
  syncFinsToggleUI();
  setDrawMsg('');
  clearPreview();
  syncAugmentUI();
  syncDrawControls();
  syncRemoveUI();
  setGizmo();
  refreshFins();
});

el('augment-toggle').addEventListener('click', () => {
  if (removeMode) cancelRemove();
  drawAugment = !drawAugment;
  setDrawMsg('');
  clearPreview();
  syncAugmentUI();
  syncDrawControls();
  setGizmo();
  refreshFins();
});

/** Bring the pad, tine, sway, cutout and nozzle state in line with the controls
 *  (a reload can keep the browser's last values). Called once at startup. */
export function initSettings() {
  syncTineGrip();
  syncPadStyle();
  syncSway();
  syncTallRibs();
  CUT.pattern = el('cutout').value;   // a reload can keep the browser's last pick
  PROP.iface = ifaceMode();
  applyTunables(tineDirTunables());   // ...and its last tine direction and pin depth (#309)
  const gap = el('gap').valueAsNumber;   // ...and its last Support gap (wireGap's range)
  if (Number.isFinite(gap)) PROP.gap = Math.min(0.4, Math.max(0.1, gap));
  applyNozzle(Number(el('nozzle').value));   // ...and the widths to the remembered nozzle
  applyWallLines(Number(el('wall-lines').value));
  fitWallLines();
}

window.addEventListener('languagechange', () => { syncCoverageUI(); if (typeof syncSectionSums === "function") syncSectionSums(); el('fins-toggle').textContent = finsVisible ? t('Fins on') : t('Add fins'); el('augment-toggle').textContent = drawAugment ? t('Done adding walls') : t('+ Add walls by hand'); });
