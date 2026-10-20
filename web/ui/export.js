/**
 * Export: the oriented part plus the fins/pad, as STL or 3MF. A 3MF holds every
 * model of the plate (ui/models.js), each where it stands; an STL, the model being
 * edited.
 */
import * as THREE from 'three';
import { writeBinarySTL, download } from '../stl.js';
import { writePlate3MF } from '../threemf.js';
import { splitInterface } from '../prop.js';
import { el } from './dom.js';
import { t } from './i18n.js';
import { finMode, finsVisible } from './settings.js';
import { part, topology, lastResult, rotM3, partName } from './part.js';
import { activeAdded, buildPending } from './finbuild.js';
import { sessionOf } from './session.js';
import { sessionForm, settingsKeyOf, VIEWER_IDS } from './history.js';
import { parkedSettled } from './parkedbuild.js';
import { exportName } from '../exportname.js';
import { nozzle } from '../nozzle.js';
import { exportAll, currentPlate, locked } from './plates.js';
import { eachModel, parkedFins, liveXY } from './models.js';
import { currentVolume } from './volume.js';
import { overlapping, arrange } from './arrange.js';

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
  return modelGeometry({
    mesh: part, topology, rot: rotM3.elements, offset: lastResult.offset, name: partName,
    // whichever walls the live mode contributes -- hand-drawn in Draw, suggested
    // in Suggest -- plus the pad, all already in print space
    added: activeAdded(), layerHeight: el('layer-height').valueAsNumber, model: undefined,
  });
}

/**
 * A model's export geometry: `mesh` (its geometry's userData) and `topology` posed
 * `rot`, seated at `offset`, with the supports it `added`; `model`, what its saved
 * session reads (session.js sessionOf; undefined: the one on screen).
 */
function modelGeometry({ mesh, topology, rot, offset, name: partName, added, layerHeight, model }) {
  const dz = offset.z;
  const dx = offset.x, dy = offset.y;
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
  const finTris = [...added];
  const base = partName.replace(/\.(stl|3mf|step|stp)$/i, '') || 'part';
  // A file with a slicer's own parts (#104) goes out as the file had it: the part
  // uncut, with its negative parts, modifiers and blockers posed the same way --
  // the fins are for the cut part, which the slicer cuts again. `partTris` stays
  // the part the fins were built for (the session and the STL use it).
  const { slicer, centre } = mesh.geometry.userData;
  const kept = slicer && centre ? {
    partTris: toPrint(slicer.positions, centre),
    colors: slicer.colors,
    extras: slicer.extras.map((e) => ({ kind: e.kind, name: e.name, settings: e.settings, tris: toPrint(e.positions, centre) })),
  } : null;
  // the two settings the slicer must match, carried in the file name (#279)
  const name = (stem, ext) => exportName(`${base}-${stem}`, ext, { nozzle, layerHeight });
  return { partTris, finTris, base, name, colors: mesh.geometry.userData.colors ?? null, slicer: kept,
           session: () => sessionOf(partTris, model) };
}

/**
 * A parked model of `plate` (ui/models.js) as buildExportGeometry gives the live one,
 * from its stash: its fins are kept to the plate's settings (ui/parkedbuild.js), so
 * it needs no making live. `shown`: `plate` is the one being edited, whose settings
 * are the page's.
 */
function parkedGeometry(m, plate, shown) {
  const s = m.stash, mesh = s.part.mesh;
  const rot = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(mesh.quaternion)).elements;
  const st = shown ? { form: sessionForm(), finMode, finsVisible } : plate.settings;
  const form = Object.fromEntries(Object.entries(st.form).filter(([id]) => !VIEWER_IDS.has(id)));
  return modelGeometry({
    mesh, topology: s.part.topology, rot, offset: mesh.position, name: s.part.name, added: s.added,
    layerHeight: shown ? el('layer-height').valueAsNumber : Number(st.form['layer-height']),
    model: { rot, offset: mesh.position, finMode: st.finMode, finsVisible: st.finsVisible, form,
             walls: s.state.walls, removed: s.state.removedSigs },
  });
}

/** `g` (buildExportGeometry) moved to `xy`, its model's spot on the plate. */
function placed(g, [x, y]) {
  const at = (tris) => tris.map((p) => { const q = p.slice(); q[0] += x; q[1] += y; return q; });
  const slicer = g.slicer && { ...g.slicer, partTris: at(g.slicer.partTris),
    extras: g.slicer.extras.map((e) => ({ ...e, tris: at(e.tris) })) };
  return { ...g, partTris: at(g.partTris), finTris: at(g.finTris), slicer };
}

/** Is every parked model of `plate` (not the one edited) built under its settings? */
export function plateReady(plate) {
  if (!plate.settings) return !plate.models.some((m) => m.stash);
  const key = settingsKeyOf(plate.settings);
  return plate.models.every((m) => !m.stash || m.stash.finsKey === key);
}

/**
 * Every model of `plate` where it stands, each its buildExportGeometry: the live one
 * as it is on screen when `plate` is the one being edited, the parked ones from
 * their stashes. A plate of one is that one as it is (its session too).
 */
export function plateGeometry(plate = currentPlate()) {
  const shown = plate === currentPlate();
  const gs = plate.models.map((m, k) => {
    if (shown && k === plate.live) {
      const g = buildExportGeometry();
      return g && placed(g, m.xy);
    }
    return m.stash ? placed(parkedGeometry(m, plate, shown), m.xy) : null;
  }).filter(Boolean);
  return gs;
}

/** The plate being edited the old way, each model made live in turn to build it
 *  (when its parked builds would not settle). */
async function plateGeometryLive() {
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
    // each where it stands on the plate, the plate's centre the bed's (ui/move.js)
    return [writePlate3MF(models, { title: gs[0].base, separate: true, bed: currentVolume(),
                                    session: gs.length === 1 ? gs[0].session() : null }),
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
    // STL and Fins only write the model being edited; 3MF the whole plate, whose
    // parked models' fins count too
    const noFins = activeAdded().length === 0 && !parkedFins();
    el('export-fins').disabled = !ready || activeAdded().length === 0;
    // the landing promises fins baked in: say so when the file would have none --
    // with fins off, the button to click; with them on (Draw with nothing drawn yet,
    // or a part with no overhang), just that the file is the part alone
    const note = el('export-nofins');
    note.hidden = !ready || !noFins;
    note.textContent = finsVisible ? t('No supports on this plate: STL and 3MF write the part alone.')
                                   : t('No fins yet: STL and 3MF write the part alone. Click Add fins first.');
    // models that collide print into each other: say so where the file is written
    // (the plate's 3MF; an STL is the model being edited alone), Arrange to hand
    const clash = ready && overlapping();
    el('export-clash').hidden = el('export-arrange').hidden = !clash;
    menu.querySelector('button:not(:disabled):not([hidden])')?.focus();
  }
}

btn.addEventListener('click', () => setOpen(menu.hidden));
for (const [id, write] of Object.entries(FORMATS)) {
  el(id).addEventListener('click', async () => {
    setOpen(false);
    // an STL is the model being edited, alone and centred (a slicer centres it
    // anyway); a 3MF of one, that one where it stands on the plate
    if (id !== 'export-3mf' || currentPlate().models.length === 1) {
      const g = buildExportGeometry();
      if (g) download(...write([id === 'export-3mf' ? placed(g, liveXY()) : g]));
      return;
    }
    // the plate's other models are parked, their fins kept to its settings: wait for
    // any still building, then write them as they stand
    if (waiting) return;
    const plate = currentPlate();
    const gs = await whileWaiting(async () => {
      const settled = await parkedSettled();
      // switched away meanwhile: that plate, if its models are current
      if (currentPlate() !== plate) return plateReady(plate) ? plateGeometry(plate) : null;
      return settled ? plateGeometry() : locked(plateGeometryLive);
    });
    if (gs?.length) download(...write(gs));
  });
}

let waiting = false;     // an export is waiting on parked builds: a second click waits too
/** Run `fn` (an export waiting on parked builds) with the spinner up, once. */
export async function whileWaiting(fn) {
  if (waiting) return null;
  waiting = true;
  const spin = setTimeout(() => el('spinner').classList.add('show'), 300);
  try {
    return await fn();
  } finally {
    clearTimeout(spin);
    if (!buildPending()) el('spinner').classList.remove('show');
    waiting = false;
  }
}
el('export-arrange').addEventListener('click', () => {
  setOpen(false);
  arrange();
});
// Every plate, one 3MF each (ui/plates.js); shown only with more than one plate.
el('export-all').addEventListener('click', () => {
  setOpen(false);
  exportAll();
});

/** `gs` (plateGeometry) as a 3MF, [blob, name], for Export all plates; null when
 *  there is nothing to write. */
export const plate3MF = (gs) => (gs.length ? FORMATS['export-3mf'](gs) : null);

/** The plate being edited the old way (plateGeometryLive), for Export all plates
 *  when one's parked builds are not current (it holds the plates still). */
export const plate3MFLive = async () => plate3MF(await plateGeometryLive());

// click-away / Esc close it, the usual menu contract
document.addEventListener('pointerdown', (e) => {
  if (!menu.hidden && !e.target.closest('.menu-wrap')) setOpen(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !menu.hidden) { setOpen(false); btn.focus(); }
});
