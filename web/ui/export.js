/**
 * Export: the oriented part plus the fins/pad, as STL or 3MF -- every model of the
 * plate (ui/models.js), each where it stands.
 */
import { writeBinarySTL, download } from '../stl.js';
import { writePlate3MF } from '../threemf.js';
import { splitInterface } from '../prop.js';
import { el } from './dom.js';
import { part, topology, lastResult, rotM3, partName } from './part.js';
import { activeAdded, buildPending } from './finbuild.js';
import { sessionOf } from './session.js';
import { exportName } from '../exportname.js';
import { nozzle } from '../nozzle.js';
import { exportAll, currentPlate, locked } from './plates.js';
import { eachModel, parkedFins } from './models.js';

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
  // the two settings the slicer must match, carried in the file name (#279)
  const name = (stem, ext) => exportName(`${base}-${stem}`, ext,
    { nozzle, layerHeight: el('layer-height').valueAsNumber });
  return { partTris, finTris, base, name, colors: part.geometry.userData.colors ?? null, slicer: kept };
}

/** `g` (buildExportGeometry) moved to `xy`, its model's spot on the plate. */
function placed(g, [x, y]) {
  const at = (tris) => tris.map((p) => { const q = p.slice(); q[0] += x; q[1] += y; return q; });
  const slicer = g.slicer && { ...g.slicer, partTris: at(g.slicer.partTris),
    extras: g.slicer.extras.map((e) => ({ ...e, tris: at(e.tris) })) };
  return { ...g, partTris: at(g.partTris), finTris: at(g.finTris), slicer };
}

/** Every model of the plate being edited, each its buildExportGeometry where it
 *  stands; a plate of one is just that one, as it is. */
async function plateGeometry() {
  if (currentPlate().models.length === 1) {
    const g = buildExportGeometry();
    return g ? [g] : [];
  }
  return (await eachModel((xy) => {
    const g = buildExportGeometry();
    return g && placed(g, xy);
  })).filter(Boolean);
}

/** A file name for the plate `gs`: the model's own, or the first one's and a count. */
const plateName = (gs, stem, ext) =>
  gs[0].name(gs.length === 1 ? stem : `and-${gs.length - 1}-more-${stem}`, ext);

// The three formats, each given the plate's models (plateGeometry). All share the
// print-space geometry, so a fins-only STL lines up with the part when both are
// imported into one plate.
const FORMATS = {
  // STL flattens part + fins into one solid.
  'export-stl': (gs) => [writeBinarySTL(gs.flatMap((g) => [...g.partTris, ...g.finTris]), gs[0].base),
                         plateName(gs, 'fins', '.stl')],
  // 3MF states millimeters, so the file opens correctly oriented and support-free
  // in Bambu Studio, OrcaSlicer, or PrusaSlicer without a re-scale or a re-rotate.
  // It writes the supports as their OWN object, so the slicer slices them apart and
  // a tine only touches the part (GitHub #38, the grip coupon's split print). The
  // site offers only this form: the old one-object assembly kept the pair from being
  // arranged apart, too small a gain for tines that fuse. It also carries the
  // session (ui/session.js), so opening it here again brings the drawn walls back.
  // With Interface material on, the walls' tops and the tines go in a second part of
  // the supports object, to set to the second filament (prop/crest.js); off, there
  // are none to split. Several models are each their own objects, in one file
  // (threemf.js writePlate3MF); the session is one model's, so only a plate of one
  // carries it.
  'export-3mf': (gs) => {
    const models = gs.map((g) => {
      const { body, iface } = splitInterface(g.finTris);
      const own = g.slicer ?? g;
      return { partTris: own.partTris, finTris: body, name: g.base, iface, colors: own.colors,
               extras: g.slicer?.extras ?? [] };
    });
    return [writePlate3MF(models, { title: gs[0].base, separate: true,
                                    session: gs.length === 1 ? sessionOf(gs[0].partTris) : null }),
            plateName(gs, 'fins', '.3mf')];
  },
  // Just the fins + pad (issue #5). One body, so 3MF would add nothing over STL.
  'export-fins': (gs) => [writeBinarySTL(gs.flatMap((g) => g.finTris), `${gs[0].base} fins`),
                          plateName(gs, 'fins-only', '.stl')],
};

const btn = el('export');
const menu = el('export-menu');

function setOpen(open) {
  menu.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  if (open) {
    // nothing to write until a part is loaded; no fins-only file without fins; and
    // nothing while a rebuild is out -- the old fins under the new settings' name
    const ready = !!(part && topology && lastResult) && !buildPending();
    el('export-stl').disabled = el('export-3mf').disabled = !ready;
    // the parked models' fins count too
    el('export-fins').disabled = !ready || (activeAdded().length === 0 && !parkedFins());
    menu.querySelector('button:not(:disabled)')?.focus();
  }
}

btn.addEventListener('click', () => setOpen(menu.hidden));
for (const [id, write] of Object.entries(FORMATS)) {
  el(id).addEventListener('click', async () => {
    setOpen(false);
    if (currentPlate().models.length === 1) {
      const g = buildExportGeometry();
      if (g) download(...write([g]));
      return;
    }
    // the plate's other models are parked: each is made live in turn to write it
    const gs = await locked(plateGeometry);
    if (!gs?.length || (id === 'export-fins' && !gs.some((g) => g.finTris.length))) return;
    download(...write(gs));
  });
}
// Every plate, one 3MF each (ui/plates.js); shown only with more than one plate.
el('export-all').addEventListener('click', () => {
  setOpen(false);
  exportAll();
});

/** The plate being edited as a 3MF, [blob, name], for Export all plates (which holds
 *  the plates still); null when there is nothing to write. */
export async function plate3MF() {
  const gs = await plateGeometry();
  return gs.length ? FORMATS['export-3mf'](gs) : null;
}

// click-away / Esc close it, the usual menu contract
document.addEventListener('pointerdown', (e) => {
  if (!menu.hidden && !e.target.closest('.menu-wrap')) setOpen(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !menu.hidden) { setOpen(false); btn.focus(); }
});
