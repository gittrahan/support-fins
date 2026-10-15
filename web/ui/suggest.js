import { t, tn } from './i18n.js';
/**
 * Suggest orientation: rank a few printable poses, list them with their fin count
 * and the "no support" / "bores clean" verdicts, and turn the part on a click.
 */
import * as THREE from 'three';
import { suggestOrientations, layerVerdict } from '../orient.js';
import { el } from './dom.js';
import { addBadge } from './toolbar.js';
import { histPush } from './history.js';
import { part, topology, threshold, shade } from './part.js';
import { materialDensity } from './settings.js';
import { lastBuilt, supportTunables } from './finbuild.js';
import { fmtGrams } from './readout.js';

const _sm4 = new THREE.Matrix4();
let suggestions = [];

/** Turn the part to a suggested pose. `rot` is a column-major 3x3. */
export function applySuggestion(rot) {
  histPush();
  // Matrix4.set takes ROW-major args; rot is column-major (THREE.Matrix3 order).
  _sm4.set(rot[0], rot[3], rot[6], 0,
           rot[1], rot[4], rot[7], 0,
           rot[2], rot[5], rot[8], 0,
           0, 0, 0, 1);
  part.quaternion.setFromRotationMatrix(_sm4);
  el('rot-delta').textContent = '';
  shade();
}

// Walls the CURRENT pose stands inside a bore/slot (props flagged inBore). They
// print fine but have to be pulled out of the hole, so we celebrate a pose for
// CLEARING the bores only when the current one has any -- the "points the holes
// up" verdict never fires on a part with no bores. Set before renderSuggestions runs.
let suggestCurBore = 0;

/**
 * The "best support is no support" verdict for a suggested pose — the product's
 * whole thesis made a first-class outcome instead of a gray "0 fins". Two tiers:
 *   free      — the pose needs NO support fins at all (regions === 0): 0 g added.
 *               A leftover rough sliver (c.holes) is a cosmetic caveat, not a
 *               support cost, so it's mentioned but doesn't disqualify the win.
 *   holeclean — it still needs external fins, but every bore prints support-free,
 *               so there is nothing to pull out of a hole afterwards. This is the
 *               "point the bore up" win.
 * Returns null for an ordinary supported pose, so the caller falls back to the
 * normal confidence line.
 */
function noSupportVerdict(c) {
  if (c.regions === 0) {
    const rough = c.holes ?? 0;
    const roughCaveat = rough ? ` One small spot may print a bit rough.` : '';
    // The suggester ranks for printability, not strength (it can't know the load).
    // If this pose also stands the part's long axis up the layers, that's the weak
    // print direction, so add a heads-up and point at the Strength arrow.
    const lv = c.size ? layerVerdict(c.size) : null;
    const strengthCaveat = lv?.posture === 'weak'
      ? ` It prints tall, though, the weaker direction, so check the Strength arrow if it bears a load.`
      : '';
    return { tier: 'free', badge: t('No support'),
      note: `${t('This way up it needs no fins, 0 g.')}${roughCaveat}${strengthCaveat}` };
  }
  if ((c.bore ?? 0) === 0 && suggestCurBore > 0) {
    const grams = (c.volume ?? 0) * materialDensity / 1000;
    return { tier: 'holeclean', badge: t('Bores clean'),
      note: `This way up the bores point up, so there's no support to pull out of a hole `
          + `(${fmtGrams(grams)} g of fins, all on the outside).` };
  }
  return null;
}

function renderSuggestions() {
  const list = el('suggest-list');
  list.replaceChildren();
  suggestions.forEach((c, i) => {
    const row = document.createElement('button');
    row.className = 'btn suggest-row';
    const point = c.seating === 'point';
    const overs = c.walls === 0 ? t('no fins') : tn('{n} fin', '{n} fins', c.walls);
    // Rough holes = the small hole/slot/bore-top overhangs this pose leaves
    // unsupported (dropped slivers). Showing it is what makes a hole-friendly
    // pose legible: "Best · 12 rough" over "#3 · 561".
    const rough = c.holes ?? 0;
    const roughTxt = rough ? ` · ${tn('{n} rough hole', '{n} rough holes', rough)}` : '';
    // A support-free pose is the headline outcome, not a footnote — badge it green
    // instead of letting it read as a dull "no overhangs → 0 fins".
    const verdict = point ? null : noSupportVerdict(c);
    // The support-free win is already carried by the green left border (.free) and
    // the "no fins" text, so its badge would just be noise. The "Bores clean" win
    // isn't obvious from the line, so that one earns a badge -- flowed inline so it
    // wraps with the text instead of floating to a lonely top-right corner.
    const badge = verdict?.tier === 'holeclean' ? ` <span class="sr-badge">${verdict.badge}</span>` : '';
    // One tight line per pose: rank · height · fins · rough holes. Bed area was
    // dropped to fit -- height already stands in for how it sits.
    const tail = point ? ` · ${t('can’t print (on a point)')}` : roughTxt;
    row.innerHTML =
      `<span class="sr-rank">${i === 0 ? t('Best') : `#${i + 1}`}</span>` +
      `<span class="sr-line">${c.height.toFixed(0)} mm · ${overs}${tail}${badge}</span>`;
    if (point) row.classList.add('bad');
    if (verdict?.tier === 'free') row.classList.add('free');
    row.addEventListener('click', () => {
      applySuggestion(c.rot);
      for (const r of list.children) r.classList.remove('active');
      row.classList.add('active');
    });
    list.append(row);
  });
  list.hidden = false;
}

/** Clear the suggestion results entirely (new part, or a manual turn that
 *  invalidates the ranking). Folding the toolbar popover does NOT come through
 *  here -- it only hides what's already there. */
export function hideSuggestions() {
  // A ranking still running belongs to what is being cleared (a new part, an undo,
  // a reset): drop it, so its list doesn't pop up after the action that cleared it.
  cancelRanking?.();
  el('suggest-list').hidden = true;
  el('suggest-list').replaceChildren();
  const note = el('suggest-note');
  note.textContent = '';
  note.className = 'hint';
}

/** A manual turn (ring drag, 90° button, lay flat) moves the part off the pose the
 *  highlighted row stands for, so drop the highlight. The ranking doesn't depend
 *  on the pose, so the list stays and any row can still be clicked. */
export function clearSuggestionMark() {
  for (const r of el('suggest-list').children) r.classList.remove('active');
}

/**
 * Rank the part's poses off the page thread (web/suggestworker.js): a big part took
 * 15-35 s and froze the page doing it here. The Worker gets the same tunables an
 * Auto build sends, so it scores with the page's gap, pad and nozzle. If no Worker
 * can run (file://, a clone or worker failure) it ranks here, as it always did.
 */
let rankId = 0;
let cancelRanking = null;   // drops the ranking in flight; it then resolves to null
function rankPoses(topo, thr) {
  let cancelled = false;
  const inline = () => new Promise((resolve, reject) => {
    // let the button repaint before the solve blocks the thread
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (cancelled) { resolve(null); return; }
      try { resolve(suggestOrientations(topo, { top: 3, threshold: thr })); } catch (err) { reject(err); }
    }));
  });
  let w = null;
  try {
    w = new Worker(new URL('../suggestworker.js', import.meta.url), { type: 'module' });
  } catch { /* no Worker here: rank inline */ }
  const id = ++rankId;
  return new Promise((resolve) => {
    const cancel = () => { cancelled = true; finish(null); };
    const done = () => { if (cancelRanking === cancel) cancelRanking = null; };
    const finish = (v) => { done(); w?.terminate(); resolve(v); };
    // inline stays cancellable until it runs: it checks `cancelled` first
    const fallBack = () => { w?.terminate(); w = null; resolve(inline().finally(done)); };
    cancelRanking = cancel;
    if (!w) { fallBack(); return; }
    w.onmessage = (e) => {
      if (e.data.id !== id) return;
      if (e.data.error) { console.warn('suggest worker failed; ranking inline', e.data.error); fallBack(); return; }
      finish(e.data.ranked);
    };
    w.onerror = () => fallBack();
    w.onmessageerror = () => fallBack();
    // the inside grid holds a closure structured clone can't copy (finbuild.js)
    const topoMsg = { ...topo };
    delete topoMsg._insideGrid;
    try {
      w.postMessage({ id, topology: topoMsg, threshold: thr, tunables: supportTunables() });
    } catch (err) {
      console.warn('suggest worker postMessage failed; ranking inline', err);
      fallBack();
    }
  });
}

el('suggest-orient').addEventListener('click', () => {
  if (!part || !topology) return;
  const btn = el('suggest-orient');
  btn.disabled = true; btn.textContent = t('Ranking…');
  const topo = topology;
  // Walls the current pose stands inside a bore -- the baseline the "points the
  // bores up" verdict measures its win against.
  const curBore = (lastBuilt?.props ?? []).filter((q) => q.inBore).length;
  rankPoses(topo, threshold).then((ranked) => {
    // cancelled (hideSuggestions), or a different part was loaded while it ranked
    if (!ranked || topo !== topology) return;
    const { candidates, confidence } = ranked;
    suggestions = candidates;
    suggestCurBore = curBore;
    if (!candidates.length || confidence === 'none') {
      el('suggest-list').hidden = true;
      el('suggest-note').textContent = confidence === 'none'
        ? t('No printable orientation: this part balances on a point at every angle.')
        : t('Nothing to suggest for this part.');
    } else {
      renderSuggestions();
      // Lead with the win when the best pose needs no support (or clears every
      // bore); otherwise fall back to the honest confidence line.
      const note = el('suggest-note');
      const verdict = candidates[0].seating === 'point' ? null : noSupportVerdict(candidates[0]);
      if (verdict) {
        note.textContent = verdict.note;
        note.className = 'hint good';
      } else {
        note.textContent = t('Click a pose to turn the part.');
        note.className = 'hint';
      }
    }
  }).catch((err) => {
    console.error('Suggest orientation failed', err);
  }).finally(() => {
    btn.disabled = false; btn.textContent = t('Suggest orientation');
  });
});

// Its badge in the view toolbar (toolbar.js): folding the popover keeps the list
// (and the ranking) intact, so reopening it shows the same poses.
addBadge('suggest-badge', { pop: 'suggest-pop' });

window.addEventListener('languagechange', () => { const btn = el('suggest-orient'); if (btn) btn.textContent = btn.classList.contains('open') ? t('Suggest orientation ▾') : t('Suggest orientation'); });
