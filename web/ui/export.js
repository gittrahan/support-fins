/**
 * Export: the oriented part plus the fins/pad, as STL or 3MF.
 */
import { writeBinarySTL, download } from '../stl.js';
import { writeThreeMF } from '../threemf.js';
import { splitInterface } from '../prop.js';
import { el } from './dom.js';
import { part, topology, lastResult, rotM3, partName } from './part.js';
import { activeAdded } from './finbuild.js';
import { sessionOf } from './session.js';

/**
 * Export the part AS ORIENTED, seated on the plate, with the fins as extra
 * solids in the same file. The whole promise of the tool is that the STL prints
 * the same way for whoever opens it, so the orientation has to be baked in --
 * exporting the original frame and hoping the user re-rotates defeats the point.
 */
/**
 * The part geometry AS ORIENTED and seated on the plate, plus the fins, kept in
 * two separate lists. STL flattens them into one solid; 3MF keeps them distinct.
 * Returns null when there is nothing to export.
 */
export function buildExportGeometry() {
  if (!part || !topology || !lastResult) return null;
  const rot = rotM3.elements;
  const dz = lastResult.offset.z;
  const dx = lastResult.offset.x, dy = lastResult.offset.y;
  const { pos } = topology;
  // flat local [x,y,z]... (less `shift`: the file's frame back to the part's) to
  // print-space vertices
  const toPrint = (flat, shift = [0, 0, 0]) => {
    const out = new Array(flat.length / 3);
    for (let v = 0; v < out.length; v++) {
      const x = flat[v * 3] - shift[0], y = flat[v * 3 + 1] - shift[1], z = flat[v * 3 + 2] - shift[2];
      out[v] = [
        rot[0] * x + rot[3] * y + rot[6] * z + dx,
        rot[1] * x + rot[4] * y + rot[7] * z + dy,
        rot[2] * x + rot[5] * y + rot[8] * z + dz,
      ];
    }
    return out;
  };

  const partTris = toPrint(pos);
  // whichever walls the live mode contributes -- hand-drawn in Draw, suggested
  // in Suggest -- plus the pad, all already in print space
  const finTris = [...activeAdded()];
  const base = partName.replace(/\.(stl|3mf|step|stp)$/i, '') || 'part';
  // A file with a slicer's own parts (#104) goes out as the file had it: the part
  // uncut, with its negative parts, modifiers and blockers posed the same way --
  // the fins are for the cut part, which the slicer cuts again. `partTris` stays
  // the part the fins were built for (the session and the STL use it).
  const { slicer, centre } = part.geometry.userData;
  const kept = slicer && centre ? {
    partTris: toPrint(slicer.positions, centre),
    colors: slicer.colors,
    extras: slicer.extras.map((e) => ({ kind: e.kind, name: e.name, settings: e.settings, tris: toPrint(e.positions, centre) })),
  } : null;
  return { partTris, finTris, base, colors: part.geometry.userData.colors ?? null, slicer: kept };
}

// The three formats. All share the print-space geometry, so a fins-only STL
// lines up with the part when both are imported into one plate.
const FORMATS = {
  // STL flattens part + fins into one solid.
  'export-stl': (g) => [writeBinarySTL([...g.partTris, ...g.finTris], g.base), `${g.base}-fins.stl`],
  // 3MF states millimeters, so the file opens correctly oriented and support-free
  // in Bambu Studio, OrcaSlicer, or PrusaSlicer without a re-scale or a re-rotate.
  // It writes the supports as their OWN object, so the slicer slices them apart and
  // a tine only touches the part (GitHub #38, the grip coupon's split print). The
  // site offers only this form: the old one-object assembly kept the pair from being
  // arranged apart, too small a gain for tines that fuse. It also carries the
  // session (ui/session.js), so opening it here again brings the drawn walls back.
  // With Interface material on, the walls' tops and the tines go in a second part of
  // the supports object, to set to the second filament (prop/crest.js); off, there
  // are none to split.
  'export-3mf': (g) => {
    const { body, iface } = splitInterface(g.finTris);
    const own = g.slicer ?? g;
    return [writeThreeMF(own.partTris, body, g.base, { separate: true, iface, colors: own.colors,
                           extras: g.slicer?.extras ?? [], session: sessionOf(g.partTris) }),
            `${g.base}-fins.3mf`];
  },
  // Just the fins + pad (issue #5). One body, so 3MF would add nothing over STL.
  'export-fins': (g) => [writeBinarySTL(g.finTris, `${g.base} fins`), `${g.base}-fins-only.stl`],
};

const btn = el('export');
const menu = el('export-menu');

function setOpen(open) {
  menu.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  if (open) {
    // nothing to write until a part is loaded; no fins-only file without fins
    const ready = !!(part && topology && lastResult);
    el('export-stl').disabled = el('export-3mf').disabled = !ready;
    el('export-fins').disabled = !ready || activeAdded().length === 0;
    menu.querySelector('button:not(:disabled)')?.focus();
  }
}

btn.addEventListener('click', () => setOpen(menu.hidden));
for (const [id, write] of Object.entries(FORMATS)) {
  el(id).addEventListener('click', () => {
    setOpen(false);
    const g = buildExportGeometry();
    if (!g) return;
    download(...write(g));
  });
}
// click-away / Esc close it, the usual menu contract
document.addEventListener('pointerdown', (e) => {
  if (!menu.hidden && !e.target.closest('.menu-wrap')) setOpen(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !menu.hidden) { setOpen(false); btn.focus(); }
});
