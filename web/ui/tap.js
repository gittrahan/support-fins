/**
 * Is this pointerup a tap (a pick) or the end of a drag / pinch (navigation)?
 *
 * The canvas handlers used to ask "did this pointer move under 4 px since the last
 * press", which a finger misses: a fingertip tap wanders more than 4 px, so taps
 * were dropped on a phone, and with two fingers down the last press stood for both,
 * so a pinch whose second finger held still and lifted first read as a tap. Now a
 * tap is one pointer, alone for its whole press, that moved under the slop: 4 px
 * for a mouse or pen (as before), 10 px for a finger.
 */
export const slop = (pointerType) => (pointerType === 'touch' ? 10 : 4);

/** The bookkeeping, apart from the DOM (tests/tap.test.js). */
export function tapTracker() {
  const down = new Map();   // pointerId -> { x, y, multi }
  return {
    press(id, x, y) {
      for (const p of down.values()) p.multi = true;
      down.set(id, { x, y, multi: down.size > 0 });
    },
    isTap(id, x, y, pointerType) {
      const p = down.get(id);
      return !!p && !p.multi && Math.hypot(x - p.x, y - p.y) <= slop(pointerType);
    },
    release(id) { down.delete(id); },
  };
}

const watched = new WeakMap();
/**
 * Track presses on `canvas` and return its isTap(pointerupEvent). One tracker per
 * canvas, however many modules ask (app.js picks, ui/plates.js plate switches).
 */
export function watchTaps(canvas) {
  if (watched.has(canvas)) return watched.get(canvas);
  const tracker = tapTracker();
  // capture: recorded before any handler on the canvas asks
  canvas.addEventListener('pointerdown', (e) => tracker.press(e.pointerId, e.clientX, e.clientY), true);
  // forgotten on the window, after every canvas pointerup handler has asked
  for (const type of ['pointerup', 'pointercancel']) {
    addEventListener(type, (e) => tracker.release(e.pointerId));
  }
  const isTap = (e) => tracker.isTap(e.pointerId, e.clientX, e.clientY, e.pointerType);
  watched.set(canvas, isTap);
  return isTap;
}
