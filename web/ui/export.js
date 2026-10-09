/**
 * Export: the oriented part plus the fins/pad, as STL or 3MF.
 */
import { writeBinarySTL, download } from '../stl.js';
import { writeThreeMF } from '../threemf.js';
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
  const { pos, nFaces } = topology;

  const partTris = new Array(nFaces * 3);
  for (let f = 0; f < nFaces; f++) {
    for (let i = 0; i < 3; i++) {
      const o = f * 9 + i * 3;
      const x = pos[o], y = pos[o + 1], z = pos[o + 2];
      partTris[f * 3 + i] = [
        rot[0] * x + rot[3] * y + rot[6] * z + dx,
        rot[1] * x + rot[4] * y + rot[7] * z + dy,
        rot[2] * x + rot[5] * y + rot[8] * z + dz,
      ];
    }
  }
  // whichever walls the live mode contributes -- hand-drawn in Draw, suggested
  // in Suggest -- plus the pad, all already in print space
  const finTris = [...activeAdded()];
  const base = partName.replace(/\.(stl|3mf|step|stp)$/i, '') || 'part';
  return { partTris, finTris, base };
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
  'export-3mf': (g) => [writeThreeMF(g.partTris, g.finTris, g.base, { separate: true, session: sessionOf(g.partTris) }),
                        `${g.base}-fins.3mf`],
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
