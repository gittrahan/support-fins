/**
 * Say so when the 3D view can't draw, instead of leaving it silently black (#387).
 *
 * Two cases the page can see: WebGL won't start at all (the renderer throws, so
 * the rest of the page never loads either), and a running context gets lost (the
 * graphics driver resets or the browser drops it; the numbers and export still
 * work, the view just stops). A browser that draws but never puts the canvas on
 * screen gives no signal, so that one stays black.
 */
import { t } from './i18n.js';

let note = null;

/** Show the banner: `kind` is 'start' (no WebGL) or 'lost' (context dropped). */
export function showGlFail(kind) {
  if (!note) {
    note = document.createElement('p');
    note.className = 'glfail';
    note.setAttribute('role', 'alert');
    document.body.appendChild(note);
  }
  note.textContent = kind === 'start'
    ? t("Your browser can't draw the 3D view: WebGL didn't start. Turn on hardware acceleration in the browser settings or update the graphics driver, then reload.")
    : t('The 3D view stopped drawing: the browser lost its graphics context (often a graphics driver reset). The numbers and export still work. Reload the page; if it keeps happening, update the graphics driver.');
  note.hidden = false;
}

/** Hide it again (the context came back). */
export function hideGlFail() {
  if (note) note.hidden = true;
}

/** Watch a renderer's canvas for its context being lost and restored. */
export function watchGl(canvas, onRestore) {
  canvas.addEventListener('webglcontextlost', () => showGlFail('lost'));
  canvas.addEventListener('webglcontextrestored', () => { hideGlFail(); onRestore(); });
}
