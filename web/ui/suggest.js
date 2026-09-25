/**
 * Suggest orientation: rank a few printable poses, list them with their fin count
 * and the "no support" / "bores clean" verdicts, and turn the part on a click.
 */
import * as THREE from 'three';
import { suggestOrientations, layerVerdict } from '../orient.js';
import { el } from './dom.js';
import { histPush } from './history.js';
import { part, topology, threshold, materialDensity, shade } from '../app.js';
import { lastBuilt } from './finbuild.js';
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

// Overhangs the CURRENT pose refuses to support inside a bore/slot (scarring a fit
// surface) — the count buildFins reports as skipped.bore. We only celebrate a pose
// for CLEARING the bore when the current one actually has that problem, so the
// "points the holes up" verdict never fires on a part with no bores. Set before
// renderSuggestions runs.
let suggestCurBore = 0;

/**
 * The "best support is no support" verdict for a suggested pose — the product's
 * whole thesis made a first-class outcome instead of a gray "0 fins". Two tiers:
 *   free      — the pose needs NO support fins at all (regions === 0): 0 g added.
 *               A leftover rough sliver (c.holes) is a cosmetic caveat, not a
 *               support cost, so it's mentioned but doesn't disqualify the win.
 *   holeclean — it still needs external fins, but every bore prints support-free,
 *               so nothing ever stands inside a hole and scars a fit surface. This
 *               is the "point the bore up" win (bore_bracket: 5 in-bore → 0).
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
    return { tier: 'free', badge: 'No support',
      note: `This way up it needs no fins, 0 g.${roughCaveat}${strengthCaveat}` };
  }
  if ((c.bore ?? 0) === 0 && suggestCurBore > 0) {
    const grams = (c.volume ?? 0) * materialDensity / 1000;
    return { tier: 'holeclean', badge: 'Bores clean',
      note: `This way up the bores point up, so no support sits inside a hole to scar it `
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
    const overs = c.walls === 0 ? 'no fins' : `${c.walls} fin${c.walls === 1 ? '' : 's'}`;
    // Rough holes = the small hole/slot/bore-top overhangs this pose leaves
    // unsupported (dropped slivers + bore-refused). Showing it is what makes a
    // hole-friendly pose legible: "Best · 12 rough" over "#3 · 561".
    const rough = (c.holes ?? 0) + (c.bore ?? 0);
    const roughTxt = rough ? ` · ${rough} rough` : '';
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
    const tail = point ? ' · can’t print (on a point)' : roughTxt;
    row.innerHTML =
      `<span class="sr-rank">${i === 0 ? 'Best' : `#${i + 1}`}</span>` +
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
 *  invalidates the ranking). The disclosure chevron does NOT come through here --
 *  it only collapses/expands what's already there. */
export function hideSuggestions() {
  el('suggest-list').hidden = true;
  el('suggest-list').replaceChildren();
  const note = el('suggest-note');
  note.textContent = '';
  note.className = 'hint';
  const tog = el('suggest-toggle');
  tog.hidden = true;
  tog.setAttribute('aria-expanded', 'true');   // next results open expanded
  el('suggest-body').hidden = false;
}

/** A manual turn (ring drag, 90° button, lay flat) moves the part off the pose the
 *  highlighted row stands for, so drop the highlight. The ranking doesn't depend
 *  on the pose, so the list stays and any row can still be clicked. */
export function clearSuggestionMark() {
  for (const r of el('suggest-list').children) r.classList.remove('active');
}

el('suggest-orient').addEventListener('click', () => {
  if (!part || !topology) return;
  const btn = el('suggest-orient');
  btn.disabled = true; btn.textContent = 'Ranking…';
  // let the button repaint before the (up to ~1s) solve blocks the thread
  requestAnimationFrame(() => requestAnimationFrame(() => {
    try {
      const { candidates, confidence } = suggestOrientations(topology, { top: 3, threshold });
      suggestions = candidates;
      // In-bore overhangs the current pose refuses (would scar a fit surface) — the
      // baseline the "points the bores up" verdict measures its win against.
      suggestCurBore = lastBuilt?.skipped?.bore ?? 0;
      // Fresh results always land expanded, with the collapse chevron available.
      const tog = el('suggest-toggle');
      tog.hidden = false;
      tog.setAttribute('aria-expanded', 'true');
      tog.setAttribute('aria-label', 'Collapse suggestions');
      tog.title = 'Collapse';
      el('suggest-body').hidden = false;
      if (!candidates.length || confidence === 'none') {
        el('suggest-list').hidden = true;
        el('suggest-note').textContent = confidence === 'none'
          ? 'No printable orientation: this part balances on a point at every angle.'
          : 'Nothing to suggest for this part.';
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
          note.textContent = 'Click a pose to turn the part.';
          note.className = 'hint';
        }
      }
    } finally {
      btn.disabled = false; btn.textContent = 'Suggest orientation';
    }
  }));
});

// Collapse/expand the results in place, keeping them (and the ranking) intact.
el('suggest-toggle').addEventListener('click', () => {
  const tog = el('suggest-toggle');
  const open = tog.getAttribute('aria-expanded') !== 'false';
  const next = !open;
  tog.setAttribute('aria-expanded', String(next));
  tog.setAttribute('aria-label', next ? 'Collapse suggestions' : 'Show suggestions');
  tog.title = next ? 'Collapse' : 'Show';
  el('suggest-body').hidden = !next;
});
