import { setLanguage, updateDomTranslations } from "./ui/i18n.js";
/**
 * Support Fins: the page's entry point. Every feature lives in web/ui/ (one
 * module each: part, pose, settings, finbuild, walls, readout, remove, strength,
 * suggest, history, io, volume, export, scene). What stays here is the wiring:
 * the pointer and keyboard dispatch between the modes, startup, and window.__sf.
 *
 * COORDINATES: Z up, millimetres, bed plane at z = 0, plate centred on the
 * origin in XY. This is the printer's frame and the same one the Python
 * generators use (tools/support/breakaway.py) -- three.js defaults to Y up, so
 * that is overridden here rather than converting at every later step.
 */
import * as THREE from 'three';
import { analyze } from './overhangs.js';
import { buildFins } from './fins.js';
import { findWallPatches } from './planes.js';
import { drawnWall } from './draw.js';
import { el } from './ui/dom.js';
import {
  renderer, scene, camera, controls, frame, resize, renderActive, requestRender, IDLE_MS,
} from './ui/scene.js';
import {
  removeActive, cancelRemove, clearFinHover, hoverRemove, clickRemove,
} from './ui/remove.js';
import { undo, redo } from './ui/history.js';
import { loadURL } from './ui/io.js';
import { applyVolume } from './ui/volume.js';
import { buildExportGeometry } from './ui/export.js';
import './ui/plugins.js';
import './ui/calibrate.js';
import './ui/topbar.js';
import './ui/navigation.js';
import './ui/camviews.js';
import './ui/scale.js';
import { updateReadout } from './ui/readout.js';
import {
  drawnWalls, drawnTris, drawStart, selectedWall, drawActive, sizeMarkers, clearPreview,
  selectWall, removeSelected, drawHover, drawClick, braceActive, braceHover, braceClick, dropBracePreview,
} from './ui/walls.js';
import { finTris, padTris, lastBuilt } from './ui/finbuild.js';
import { initSettings } from './ui/settings.js';
import './ui/search.js';
import './ui/tips.js';
import { part, topology, rotM3, lastResult, threshold } from './ui/part.js';
import { gizmo, hoverFace, layActive, cancelLay, layHover, layClick, ringPressTurned, clearRingPress } from './ui/pose.js';
import { planeBusy, renderGhost } from './ui/section.js';
import { moveActive } from './ui/move.js';

// ------------------------------------------------------------------ keyboard

// Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z (or Ctrl+Y) redoes. Ignored while typing
// in a field so it never eats a text-edit undo.
addEventListener('keydown', (e) => {
  if (!part) return;
  const tag = e.target.tagName;
  // Undo/redo from a slider, checkbox or menu too: focus stays on one after you use it,
  // and ⌘Z then did nothing. A text or number field keeps its own text undo.
  const textField = tag === 'TEXTAREA' || (tag === 'INPUT' && !['range', 'checkbox', 'radio'].includes(e.target.type));
  const histKey = (e.metaKey || e.ctrlKey) && ['z', 'y'].includes(e.key.toLowerCase());
  if (textField || ((tag === 'INPUT' || tag === 'SELECT') && !histKey)) return;
  if (selectedWall && (e.key === 'Delete' || e.key === 'Backspace')) {
    e.preventDefault();
    removeSelected();
    return;
  }
  if (!(e.metaKey || e.ctrlKey)) return;
  const k = e.key.toLowerCase();
  if (k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (k === 'y') { e.preventDefault(); redo(); }
});

// ---------------------------------------------------------- pointer dispatch
// One set of viewport listeners, routed by mode: remove, then draw, then lay flat.

let pressAt = null;
let pressOnPlane = false;   // the press landed on the section plane's handle
renderer.domElement.addEventListener('pointermove', (ev) => {
  // Move (ui/move.js) owns the pointer: no pick lights up under a drag
  if (moveActive()) {
    hoverFace.visible = false;
    clearFinHover();
    return;
  }
  // The section plane's handle is under the pointer or being dragged: it owns the
  // pointer, and no pick should light up through it.
  if (planeBusy()) {
    hoverFace.visible = false;
    clearFinHover();
    return;
  }
  // Remove-fins mode: hover lights the fin a click would drop, in red.
  if (removeActive()) {
    hoverFace.visible = false;
    hoverRemove(ev);
    return;
  }
  // Draw / Suggest "+ Add": the pointer places wall endpoints ON the overhang, so
  // face-lay hover is off and the cursor / band / ghost track the surface instead.
  // Draw picks ANY surface point the user aims at -- including the red overhang
  // faces themselves -- because a drawn breakaway wall sweeps under the line you
  // draw, wherever you draw it; there is no "grippable face" gate to fight.
  if (drawActive()) {
    hoverFace.visible = false;
    drawHover(ev);
    return;
  }
  // Auto / Full with Sway braces on: an upright side previews the brace a click stands.
  // An orbit or ring drag owns the pointer: the preview goes, not left behind. Over
  // the rings without a drag it still shows: a drag there turns the part, a click
  // stands the brace.
  if (!layActive() && braceActive()) {
    if (gizmo.dragging || pressAt) dropBracePreview();
    else if (braceHover(ev)) { hoverFace.visible = false; return; }
  }
  // Face-lay hover ONLY while armed: otherwise a highlighted, clickable-looking
  // face invites the stray click that silently re-lays the part. Off by default,
  // clicks just orbit.
  if (!layActive() || !part || gizmo.dragging || gizmo.axis || pressAt) {
    hoverFace.visible = false;
    return;
  }
  layHover(ev);
});

renderer.domElement.addEventListener('pointerleave', () => {
  hoverFace.visible = false;
  clearFinHover();
});

renderer.domElement.addEventListener('pointerdown', (e) => {
  pressAt = { x: e.clientX, y: e.clientY };
  clearRingPress();   // the rings' own press handler ran first; a turn is only known on release
  // Read at the press: the plane's TransformControls listens first, so it has set
  // its axis by now -- and on release it clears it before this module's pointerup.
  pressOnPlane = planeBusy();
});

renderer.domElement.addEventListener('pointerup', (e) => {
  const from = pressAt;
  pressAt = null;
  if (!from || !part || !topology) return;

  // a drag is an orbit, not a pick; with Move on, nothing is picked (a click on a
  // parked model still edits it: ui/plates.js)
  if (Math.hypot(e.clientX - from.x, e.clientY - from.y) > 4 || moveActive()) return;
  // a click on the section plane's handle is the handle's, not a pick
  if (pressOnPlane) return;

  // A right CLICK cancels; a right DRAG is an orbit or pan (the Onshape preset
  // orbits on it) and leaves the wall in progress alone. Decided here, on release,
  // not in contextmenu: macOS fires that on the press, before any drag.
  // Ctrl+click is the Mac's right click (one-button trackpads), and nothing else
  // uses a Ctrl+click here, so it cancels on every platform.
  if (e.button === 2 || (e.button === 0 && e.ctrlKey)) { cancelArmed(); return; }
  // Only the left button picks: a middle click is navigation in the CAD presets.
  if (e.button !== 0) return;

  // Remove-fins mode: one click drops just the fin under the pointer.
  if (removeActive()) {
    clickRemove(e);
    return;
  }

  // Draw / Suggest "+ Add": first click sets the start of a wall on the overhang,
  // second commits it. A breakaway wall sweeps under the line between the two
  // points, so the user draws it straight onto the red overhang -- no face gate.
  if (drawActive()) {
    drawClick(e);
    return;
  }

  // Auto / Full with Sway braces on: a click on an upright side (or a brace placed
  // by hand) is the brace's, even over the rotate rings -- unless the press turned
  // the part (a ring snaps 5 deg within the 4 px a click allows): that was a turn.
  if (!layActive() && braceActive() && !ringPressTurned() && braceClick(e)) return;

  if (gizmo.dragging || gizmo.axis) return;

  // Lay a face flat -- ONLY when armed via the button. Off by default so a stray
  // viewport click orbits instead of silently discarding a careful rotation.
  if (layActive()) layClick(e);
});

// Cancel an armed mode / wall-in-progress: Escape, or a right-click in the viewport.
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (removeActive()) { cancelRemove(); return; }
  if (layActive()) { cancelLay(); return; }
  if (drawActive() && drawStart) {
    clearPreview();
    updateReadout(lastBuilt);
  } else if (selectedWall) {
    selectWall(selectedWall);        // toggles it off
  }
});
/** Right-click (pointerup above): the same cancel as Escape for an armed mode. */
function cancelArmed() {
  if (removeActive()) { cancelRemove(); return; }
  if (layActive()) { cancelLay(); return; }
  if (drawActive() && drawStart) { clearPreview(); updateReadout(lastBuilt); }
}
// No browser menu over the viewport while a mode is armed (the orbit controls
// suppress it too, but not while a ring drag has them disabled).
renderer.domElement.addEventListener('contextmenu', (e) => {
  if (removeActive() || layActive() || drawActive()) e.preventDefault();
});

// ----------------------------------------------------------------- main loop

const fpsEl = el('fps');
let frames = 0, last = performance.now();

let lastDraw = -Infinity;
const camPos = new THREE.Vector3(), camQuat = new THREE.Quaternion();
function tick(now) {
  requestAnimationFrame(tick);
  // idle: nothing has signalled a change (scene.js, "render on demand") -- draw
  // only every IDLE_MS as a safety net, and say so instead of a frame rate
  if (!renderActive(now)) {
    if (now - lastDraw < IDLE_MS) return;
    fpsEl.textContent = 'idle';
    frames = 0;
    last = now;
  } else if (now - lastDraw > 100) {
    frames = 0;          // back from a pause: don't count the gap as slow frames
    last = now;
  }
  lastDraw = now;
  controls.update();
  // OrbitControls only says 'change' past 1 mm of motion, and the tail of its
  // easing moves less than that a frame: keep drawing while the camera moves at all
  if (!camPos.equals(camera.position) || !camQuat.equals(camera.quaternion)) {
    camPos.copy(camera.position);
    camQuat.copy(camera.quaternion);
    requestRender(250);
  }
  sizeMarkers();
  renderer.render(scene, camera);
  renderGhost();
  if (renderActive(now) && ++frames >= 20) {
    fpsEl.textContent = `${Math.round((frames * 1000) / (now - last))} fps`;
    frames = 0;
    last = now;
  }
}

initSettings();
applyVolume();
resize();
frame(new THREE.Vector3(60, 60, 60));
requestAnimationFrame(tick);

// debug surface, used to cross-check against the Python probes
window.__sf = { get part() { return part; }, camera, get topo() { return topology; },
                analyze, get threshold() { return threshold; },
                get rot() { return rotM3.elements; },
                get result() { return lastResult; },
                get finTris() { return finTris; },
                get padTris() { return padTris; },
                get drawnTris() { return drawnTris; },
                get drawnWalls() { return drawnWalls; },
                buildFins, findWallPatches, drawnWall, buildExportGeometry };

const wanted = new URLSearchParams(location.search).get('stl');
if (wanted) loadURL(wanted).catch((err) => console.error('?stl=', err));

// Language Dropdown Menu
const langBtn = document.getElementById('lang-btn');
const langMenu = document.getElementById('lang-menu');
if (langBtn && langMenu) {
  langBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = !langMenu.hidden;
    langMenu.hidden = open;
    langBtn.setAttribute('aria-expanded', String(!open));
  });
  document.addEventListener('click', () => {
    langMenu.hidden = true;
    langBtn.setAttribute('aria-expanded', 'false');
  });
  document.getElementById('lang-opt-en')?.addEventListener('click', () => {
    setLanguage('en');
    langMenu.hidden = true;
    langBtn.setAttribute('aria-expanded', 'false');
  });
  document.getElementById('lang-opt-de')?.addEventListener('click', () => {
    setLanguage('de');
    langMenu.hidden = true;
    langBtn.setAttribute('aria-expanded', 'false');
  });
  document.getElementById('lang-opt-zh')?.addEventListener('click', () => {
    setLanguage('zh');
    langMenu.hidden = true;
    langBtn.setAttribute('aria-expanded', 'false');
  });
  document.getElementById('lang-opt-pt')?.addEventListener('click', () => {
    setLanguage('pt');
    langMenu.hidden = true;
    langBtn.setAttribute('aria-expanded', 'false');
  });
  document.getElementById('lang-opt-ar')?.addEventListener('click', () => {
    setLanguage('ar');
    langMenu.hidden = true;
    langBtn.setAttribute('aria-expanded', 'false');
  });
  document.getElementById('lang-opt-nl')?.addEventListener('click', () => {
    setLanguage('nl');
    langMenu.hidden = true;
    langBtn.setAttribute('aria-expanded', 'false');
  });
}
updateDomTranslations();
