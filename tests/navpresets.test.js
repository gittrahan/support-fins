// Mouse navigation presets (#53): every preset can orbit, pan and zoom with a
// mouse, Default is unchanged, and the CAD presets leave left-drag to the picks.
import { MOUSE } from '../web/vendor/three/three.core.js';
import { NAV_PRESETS, navPreset } from '../web/ui/navpresets.js';
import { assert } from './_util.js';

const ACTIONS = new Set([MOUSE.ROTATE, MOUSE.DOLLY, MOUSE.PAN, null]);

Deno.test('navpresets: Default is the old OrbitControls mapping', () => {
  const b = NAV_PRESETS.default.buttons;
  assert(b.LEFT === MOUSE.ROTATE && b.MIDDLE === MOUSE.DOLLY && b.RIGHT === MOUSE.PAN,
    `default changed: ${JSON.stringify(b)}`);
});

Deno.test('navpresets: every preset orbits and pans with a mouse button', () => {
  for (const [key, p] of Object.entries(NAV_PRESETS)) {
    const acts = Object.values(p.buttons);
    for (const a of acts) assert(ACTIONS.has(a), `${key}: unknown action ${a}`);
    // A modifier swaps ROTATE <-> PAN on the same button (OrbitControls), so
    // either one bound gives both.
    assert(acts.includes(MOUSE.ROTATE) || acts.includes(MOUSE.PAN), `${key}: no orbit/pan`);
    assert(p.label && p.hint, `${key}: missing label or hint`);
  }
});

Deno.test('navpresets: the CAD presets keep left-drag for picking', () => {
  for (const key of ['fusion', 'onshape', 'solidworks', 'blender']) {
    assert(NAV_PRESETS[key].buttons.LEFT === null, `${key}: left drag navigates`);
  }
});

Deno.test('navpresets: the chords match the packages', () => {
  const b = (k) => NAV_PRESETS[k].buttons;
  assert(b('fusion').MIDDLE === MOUSE.PAN, 'Fusion: middle pans (Shift+middle orbits)');
  assert(b('onshape').RIGHT === MOUSE.ROTATE && b('onshape').MIDDLE === MOUSE.PAN, 'Onshape');
  assert(b('solidworks').MIDDLE === MOUSE.ROTATE, 'SolidWorks: middle orbits (Ctrl+middle pans)');
  assert(b('blender').MIDDLE === MOUSE.ROTATE, 'Blender: middle orbits (Shift+middle pans)');
});

Deno.test('navpresets: an unknown stored key falls back to Default', () => {
  assert(navPreset('maya') === NAV_PRESETS.default);
  assert(navPreset(undefined) === NAV_PRESETS.default);
  assert(navPreset('toString') === NAV_PRESETS.default, 'prototype key leaked through');
});
