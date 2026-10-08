/**
 * Mouse navigation presets (#53): which button orbits, pans and zooms, matched to
 * the CAD packages people come from. Pure data so tests can pin it; ui/navigation.js
 * applies one to the OrbitControls.
 *
 * OrbitControls swaps orbit and pan while Shift/Ctrl/Cmd is held on a button, so a
 * modifier chord comes free: MIDDLE: PAN means Shift+middle orbits (Fusion), and
 * MIDDLE: ROTATE means Shift- or Ctrl+middle pans (Blender, SolidWorks). The wheel
 * zooms in every preset. null leaves a button to the app: in the CAD presets a left
 * drag no longer orbits, so left stays the button that picks (draw, lay flat, the
 * rings), as it does in those packages. Touch is not affected.
 */
import { MOUSE } from '../vendor/three/three.core.js';

export const NAV_PRESETS = {
  default: {
    label: 'Default',
    hint: 'Left-drag orbits, right-drag pans, wheel zooms.',
    buttons: { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN },
  },
  fusion: {
    label: 'Fusion 360',
    hint: 'Shift + middle-drag orbits, middle-drag pans, wheel zooms.',
    buttons: { LEFT: null, MIDDLE: MOUSE.PAN, RIGHT: null },
  },
  onshape: {
    label: 'Onshape',
    hint: 'Right-drag orbits, middle- or Ctrl + right-drag pans, wheel zooms.',
    buttons: { LEFT: null, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.ROTATE },
  },
  solidworks: {
    label: 'SolidWorks',
    hint: 'Middle-drag orbits, Ctrl + middle-drag pans, wheel zooms.',
    buttons: { LEFT: null, MIDDLE: MOUSE.ROTATE, RIGHT: null },
  },
  blender: {
    label: 'Blender',
    hint: 'Middle-drag orbits, Shift + middle-drag pans, wheel zooms.',
    buttons: { LEFT: null, MIDDLE: MOUSE.ROTATE, RIGHT: null },
  },
};

/** The preset for a stored key, falling back to Default for an unknown one (own
 *  keys only: a corrupted 'toString' must not come back as a function). */
export const hasNavPreset = (key) => Object.hasOwn(NAV_PRESETS, key);
export const navPreset = (key) => (hasNavPreset(key) ? NAV_PRESETS[key] : NAV_PRESETS.default);
