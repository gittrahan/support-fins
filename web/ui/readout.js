/**
 * The status readout: the Fins/Pad rows, the note under them and its (i), the
 * grams receipt, and why a part got no fins.
 */
import { PAD } from '../fins.js';
import { el } from './dom.js';
import { removedIds } from './remove.js';
import { drawnWalls, drawMsg, selectedWall, selectedNote, drawShown, drawMaterial } from './walls.js';
import {
  finMode, finsVisible, materialDensity, syncSectionSums,
} from './settings.js';
import { analysisTiming } from './part.js';
import { activeAdded, finMaterial, padMaterial } from './finbuild.js';

/**
 * Why did this part get no fins, in terms the user can act on?
 *
 * "No flat vertical face" is technically true and useless: it does not say
 * whether to rotate the part, accept it, or wait for draw mode. Each stage of
 * the search discards candidates for a different reason, so name the stage that
 * actually emptied out.
 */
function explainNoFins(b) {
  // A part balanced on a point cannot be rescued by ANY support UNLESS the
  // bed pad is on to seat it (the shelter hubs print exactly that way), so
  // saying "no flat face" or "part in the way" sends the user to tune
  // something that was never the problem. This outranks every mode-specific
  // reason below.
  if (b.seating?.kind === 'point' && !b.pad) {
    return 'this part touches the plate at a single point, so it has nothing to '
         + 'stand on. Turn the bed pad on to seat it, or rotate until it sits '
         + 'down on a face or an edge';
  }
  if (b.mode === 'prop') {
    const s = b.skipped ?? {};
    if (!b.rejected.sites) return 'no overhangs to prop in this orientation';
    // Named in the order that tells the user the most. Each is a different
    // stage of the search, and lumping them into "blocked" is what let M5 be
    // recorded as working on a part where it built nothing.
    if (s.wanders) {
      const one = s.wanders === 1;
      return `${s.wanders} overhang${one ? ' is' : 's are'} bowl-shaped rather than `
           + `a ledge — ${one ? 'its' : 'their'} lowest points form a ring, not a `
           + 'line, so there is nothing for a wall to follow. Rotate, or switch '
           + 'to Draw and place one by hand';
    }
    if (s.buried || s.weld) {
      return 'every wall that reaches these overhangs would fuse to the '
           + 'part — rotate, or switch to Draw and place one by hand';
    }
    if (s.blocked) {
      return 'no run of these overhangs is long enough to stand a wall under — '
           + 'the part is in the way, or they sit too close to the plate';
    }
    if (s.stub || s.noLine || s.sliver) {
      return 'the overhangs here are too small or too low to be worth a wall';
    }
    if (s.degenerate) {
      return 'the contact lines here collapse to a point — nothing to sweep along';
    }
    return 'no overhang here can take a prop in this orientation';
  }
  const st = b.patchStats ?? {};
  if (!b.patchCount) {
    // a cylinder or a mesh of small facets has no flat face wide enough
    return (st.tooNarrow ?? 0) > (st.notFlat ?? 0)
      ? 'nothing flat and wide enough to stand a fin against — curved or '
        + 'finely faceted surfaces have no flat face to grip'
      : 'no flat upright face on this part in this orientation';
  }
  if (!b.rejected.sites) {
    return st.tooHigh
      ? `${st.tooHigh} flat face${st.tooHigh === 1 ? '' : 's'} found, but every `
        + 'one starts too far up the part — a fin would be mostly bare stilt. '
        + 'Rotate so a flat face runs down to the plate'
      : 'no usable face in this orientation — try rotating';
  }
  if (b.rejected.blocked) {
    return 'the part is in the way of every wall position on the faces it found '
         + '— rotate, or switch to Draw and place one by hand';
  }
  return 'the workable spots would put the fin inside the part — try rotating';
}

// Grams use the selected material's density (materialDensity, set by applyMaterial),
// so the number is honest rather than pretending to be machine truth.

/** Signed volume of a closed triangle-soup, mm^3. Fins and pad are closed solids. */
function meshVolumeMM3(tris) {
  let v = 0;
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i], b = tris[i + 1], c = tris[i + 2];
    v += a[0] * (b[1] * c[2] - b[2] * c[1])
       - a[1] * (b[0] * c[2] - b[2] * c[0])
       + a[2] * (b[0] * c[1] - b[1] * c[0]);
  }
  return Math.abs(v) / 6;
}

export const fmtGrams = (g) => (g < 9.95 ? g.toFixed(1) : String(Math.round(g)));

/**
 * The "what did this actually get me" receipt. The headline -- the mass of
 * breakaway support the tool adds -- is EXACT (we generate that geometry, and
 * this volume was cross-checked against buildFins' own wall volume). It ticks as
 * you re-orient, so a better pose visibly costs less support.
 *
 * The saving vs. the slicer's own supports is deliberately NOT computed per part:
 * we can't slice in the browser, and a made-up "you saved 5.2 g" is exactly what
 * loses trust on the first print. Instead the sub-line states the MEASURED result
 * from the test prints (see video notes), which is a claim we can stand behind.
 */
function updateReceipt() {
  const box = el('receipt');
  const added = activeAdded();
  if (!finsVisible || !added.length) { box.hidden = true; return; }
  const grams = meshVolumeMM3(added) * materialDensity / 1000;
  el('r-grams').textContent = `${fmtGrams(grams)} g`;
  box.hidden = false;
}

/** Route the readout to the active mode. */
export function updateReadout(built, ms) {
  if (finMode === 'draw') updateDrawReadout(built, ms);
  else updateFinReadout(built, ms);
  updateReceipt();
}

/**
 * Two audiences, two homes. `lead` is the short, must-see stuff -- a support that
 * couldn't build, a part balanced on a point -- and stays in the status panel.
 * `detail` is the how-it-works / how-to-fix text, which reads as a wall when it's
 * always on, so it's tucked behind the (i) on the Fins row where a curious user
 * can hover for it. Either can be empty.
 */
function setFinNote(lead, detail) {
  el('s-fin-note').textContent = lead.length ? lead.join('. ') + '.' : '';
  const info = el('s-fin-info');
  const text = detail.filter(Boolean).join(' ');
  if (text) { info.title = text; info.hidden = false; }
  else { info.title = ''; info.hidden = true; }
}

/**
 * Draw mode's readout. Reports the breakaway WALLS the user drew by hand (a wall
 * per line, straight onto the overhang), plus the pad/seating verdict from
 * buildFins. When a drawn wall can't build it says WHY -- silence-as-success is
 * the exact bug M5's scoreboard was built on.
 */
function updateDrawReadout(built, ms) {
  finMaterial.transparent = padMaterial.transparent = drawMaterial.transparent = false;
  finMaterial.opacity = padMaterial.opacity = drawMaterial.opacity = 1;
  const box = el('s-fins');
  el('s-pad').textContent = built ? padStatus(built) : '—';

  const ok = drawnWalls.filter((w) => w.ok);
  const bad = drawnWalls.length - ok.length;
  const tines = ok.reduce((a, w) => a + (w.info?.tines ?? 0), 0);
  const braces = ok.filter((w) => w.kind === 'sway').length;
  const walls = ok.length - braces;
  const parts = [];
  if (walls) parts.push(`${walls} drawn wall${walls === 1 ? '' : 's'}`);
  if (braces) parts.push(`${braces} sway brace${braces === 1 ? '' : 's'}`);
  box.textContent = ok.length
    ? parts.join(' + ') + (tines ? ` · ${tines} tines` : '')
    : 'none yet';
  box.classList.toggle('warn', ok.length === 0);

  const lead = [];
  const help = [];
  if (!drawnWalls.length && !drawMsg) {
    lead.push('Click two points across an overhang (a line lands right where you '
      + 'draw it, red faces included) to lay a breakaway wall under it');
  }
  if (ok.length) {
    help.push(tines
      ? 'The tines grab onto the part and bend away when you snap the wall off.'
      : 'Each wall stops a hair under the part (0.2mm) so it snaps off clean. Turn '
        + 'Tines on if you want it to grip the part.');
  }
  // A brace you place by hand is built even where Auto would refuse to stand one,
  // so say what it is doing: below its first tine it holds nothing and nothing
  // holds it, which is worth knowing but is your call to make.
  const stilted = ok.filter((w) => w.kind === 'sway' && (w.info?.stilt ?? 0) > 20);
  if (stilted.length) {
    const tallest = Math.max(...stilted.map((w) => w.info.stilt));
    help.push(`${stilted.length === 1 ? 'One brace stands' : `${stilted.length} braces stand`} `
      + `up to ${Math.round(tallest)}mm before gripping the part — that much of it prints as a `
      + 'lone wall. Fine if it prints; rotate so that side reaches the plate if it wobbles.');
  }
  if (bad) {
    const one = drawnWalls.find((w) => !w.ok);
    lead.push(`${bad} wall${bad === 1 ? '' : 's'} couldn’t build here`
      + `${one?.info?.reason ? ` (${one.info.reason})` : ''}. Undo, or redraw`);
  }
  if (drawMsg) lead.push(drawMsg);
  if (selectedWall) lead.push(selectedNote());
  if (built?.seating?.kind === 'point') {
    lead.push(built.pad
      ? 'this part balances on one point, so the bed pad is holding it. Print with the pad on'
      : 'this part balances on one point. Turn the bed pad on to seat it, or rotate until it sits down');
  }
  if (built && padNote(built)) lead.push(padNote(built));
  setFinNote(lead, help);
  if (ms != null) el('s-time').textContent = `${analysisTiming} · pad ${ms.toFixed(0)} ms`;
}

/**
 * The Light pad grips by first-layer squish along the part's first-layer outline.
 * A part on a point or a small round foot has only a few mm of it, so fins.js
 * builds Sure hold there instead (pad.autoSure) -- say so, since the user picked
 * Light. A Custom pad with a gap on such a foot gets a warning instead of a swap.
 */
function padStatus(built) {
  syncAutoLabel(built);
  if (!built.pad) return 'not needed';
  return built.pad.autoSure ? 'Sure hold (small foot)' : 'added';
}
// The Auto option names what it built, so the dropdown never claims Light while
// the pad on screen is Sure hold.
function syncAutoLabel(built) {
  const opt = el('bed-pad').querySelector('option[value="auto"]');
  const p = built?.pad;
  opt.textContent = !p || PAD.style !== 'auto' ? 'Auto'
    : p.style === 'sure' ? 'Auto (Sure hold)' : 'Auto (Light)';
  syncSectionSums();
}
function padNote(built) {
  const p = built.pad;
  if (!p?.smallFoot) return '';
  const mm = p.outline < 1 ? 'under 1 mm' : `${p.outline.toFixed(0)} mm`;
  if (p.autoSure) {
    return `this part meets the plate on a small foot (${mm} of first-layer edge), too little for a `
         + 'Light pad to grip, so Auto made it Sure hold, touching the part to hold it';
  }
  if (PAD.style === 'light') {
    return `this part meets the plate on a small foot (${mm} of first-layer edge); a Light pad has `
         + 'almost nothing to grip. Auto or Sure hold holds it';
  }
  if (PAD.style === 'custom' && PAD.custom.gap > 0) {
    return `this part meets the plate on a small foot (${mm} of first-layer edge); a pad with a gap `
         + 'has almost nothing to grip. Sure hold, or Pad gap 0, holds it';
  }
  return '';
}

function updateFinReadout(built, ms) {
  finMaterial.transparent = padMaterial.transparent = false;
  finMaterial.opacity = padMaterial.opacity = 1;
  const box = el('s-fins');
  if (!built) {
    box.textContent = '—';
    box.classList.remove('warn');
    el('s-pad').textContent = '—';
    setFinNote([], []);
    return;
  }
  el('s-pad').textContent = padStatus(built);
  const n = built.fins.length;
  const kind = built.mode === 'prop' ? 'prop' : 'fin';
  // Hand-added walls (Suggest + Draw mix) count toward the tally too.
  const drawnOk = drawShown() ? drawnWalls.filter((w) => w.ok).length : 0;
  let autoTxt;
  if (built.mode === 'auto') {
    // Named apart so the readout is honest: the support fins sit on the overhangs
    // (tined when the toggle is on), the props are the fallback under ledges too
    // flat to take a fin. "N fins" alone would hide which is which.
    const p = built.propCount, b = built.braceCount;
    const seg = [];
    if (b) seg.push(`${b} support fin${b === 1 ? '' : 's'}` + (built.tines ? ` · ${built.tines} tines` : ''));
    if (p) seg.push(`${p} prop${p === 1 ? '' : 's'}`);
    autoTxt = seg.join(' + ');
  } else {
    autoTxt = n
      ? `${n} ${kind === 'prop' ? 'prop' : 'support fin'}${n === 1 ? '' : 's'}`
        + (built.mode === 'prop' || !built.tines ? '' : ` · ${built.tines} tines`)
      : '';
  }
  const drawnTxt = drawnOk ? `${autoTxt ? ' + ' : ''}${drawnOk} drawn` : '';
  const removedN = removedIds.size;
  const removedTxt = removedN ? ` (${removedN} removed)` : '';
  const sw = built.sway;
  const swayTxt = sw?.count
    ? `${autoTxt || drawnTxt ? ' + ' : ''}${sw.count} sway brace${sw.count === 1 ? '' : 's'}`
      + (sw.tines ? ` · ${sw.tines} brace tines` : '')
    : '';
  box.textContent = (autoTxt + drawnTxt + swayTxt + removedTxt) || 'none possible';
  box.classList.toggle('warn', n === 0 && !drawnOk && !sw?.count);

  // `lead` = short + must-see, stays in the panel; `help` = how-it-works and
  // how-to-fix, goes behind the (i). Split so the panel doesn't read as a wall.
  const lead = [];
  const help = [];
  if (!n && !drawnOk) {
    // Nothing placed -- the box already says "none possible"; the why goes in the
    // (i), since it's a paragraph and the user can hover for it.
    help.push(explainNoFins(built));
  } else if (n) {
    if (built.mode === 'auto') {
      // Make "why no tines" legible: props never take tines, only the gripping
      // fins do, so a part that gets only props shows no tines and that's correct.
      const b = built.braceCount, p = built.propCount;
      if (b) {
        help.push(built.tines
          ? 'The tines grab onto the part and bend away when you snap the supports off.'
          : 'The fins stand a hair off the part (0.2mm) so they pop off. Turn Tines on if you want them to grip.');
      }
      if (p && !b) {
        help.push('These are plain props, not gripping fins. The overhangs here are '
          + 'too shallow or curved to stand a fin against, so there are no tines to add.');
      } else if (p) {
        help.push(`The ${p} prop${p === 1 ? '' : 's'} sit under overhangs too shallow `
          + 'to grip, so those get no tines.');
      }
    } else if (built.mode === 'prop') {
      help.push('Each one stops a hair under the part (0.2mm) so it pops off instead of needing a cut.');
    }
  }
  if (drawnOk) {
    lead.push(`plus ${drawnOk} wall${drawnOk === 1 ? '' : 's'} you added by hand`);
  }
  // Hand-placement feedback has to surface here too (Suggest + Draw mix), or a
  // rejected wall fails silently -- the same silence-as-success trap as M5. This
  // one is an interactive failure, so it stays visible, not behind the (i).
  if (drawShown()) {
    const bad = drawnWalls.length - drawnOk;
    if (bad) {
      const one = drawnWalls.find((w) => !w.ok);
      lead.push(`${bad} drawn wall${bad === 1 ? '' : 's'} couldn’t attach here`
              + (one?.info?.reason ? ` (${one.info.reason})` : ''));
    }
    if (drawMsg) lead.push(drawMsg);
    if (selectedWall) lead.push(selectedNote());
  }
  // Worth saying even when something WAS placed: a point-balanced part is
  // standing on the added pad and nothing else, so the pad is load-bearing,
  // not cosmetic. Must-see -> stays visible.
  if (n && built.seating?.kind === 'point') {
    lead.push(built.pad
      ? 'this part balances on one point, so the bed pad is holding it. Print with the pad on'
      : 'this part balances on one point with nothing under it. Turn the bed pad on, or rotate until it sits down');
  }
  if (padNote(built)) lead.push(padNote(built));
  if (built.sagRisk) {
    // The coverage slider is left of centre, so a broad flat overhang got rows
    // spaced wider than the 12mm anti-sag guide. That's allowed on purpose (fewer
    // supports), but the plate can bow between them -- must-see, so it's in the
    // panel, not behind the (i).
    lead.push('coverage is below the anti-sag guide, so a broad overhang may sag '
            + 'between supports — nudge the slider right if the surface bows');
  }
  if (built.unserved) {
    // An un-served ledge is a shallow overhang with no room for a prop and too
    // flat to stand a fin against. The fix (tilt steeper) is a sentence, so it
    // rides in the (i) rather than the panel.
    help.push(`${built.unserved} overhang${built.unserved === 1 ? ' is' : 's are'} `
            + 'too shallow for a fin this way up. Tilt the part steeper so a fin can '
            + 'follow it (try Suggest orientation), or add a wall by hand.');
  }
  if (built.skipped?.bore) {
    // A support standing INSIDE a bore or slot scars a surface you can't clean --
    // worse than a little sag. The tool refuses those on purpose; the honest fix
    // is to rotate the hole so it faces out and prints clean with no support.
    const b = built.skipped.bore;
    help.push(`${b} overhang${b === 1 ? ' sits' : 's sit'} inside a bore or slot, `
            + `where a support would leave a mark you can’t reach. The tool leaves `
            + `${b === 1 ? 'it' : 'them'} alone, so turn the hole upward to print `
            + `${b === 1 ? 'it' : 'them'} clean.`);
  }
  // Sway braces were asked for, so say what they did -- and why, if nothing.
  if (sw) {
    if (!sw.count) lead.push(`no sway braces: ${sw.reason}`);
    else {
      help.push('The sway braces stand edge-on against the tall sides and are tied on '
        + 'by tines all the way up, so the top can’t drift or wobble as it prints.');
      if (sw.skipped) {
        help.push(`${sw.skipped} brace spot${sw.skipped === 1 ? ' was' : 's were'} blocked by `
          + 'the part itself. Switch to Draw and click an upright side to place one by hand.');
      }
    }
  }
  setFinNote(lead, help);
  // ms is absent when a hand-drawn wall (Suggest + Draw mix) re-runs the readout
  // without rebuilding the auto fins -- don't touch the timing line then, and
  // never throw, or the updateReceipt() call after this one never happens.
  if (ms != null) el('s-time').textContent = `${analysisTiming} · fins ${ms.toFixed(0)} ms`;
}
