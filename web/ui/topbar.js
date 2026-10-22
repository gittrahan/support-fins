// The top bar wraps onto more rows on a narrow window (style.css #topbar), so its
// height isn't fixed. Keep --topbar-h at the bar's real height plus a pixel, the
// gap the rails and the narrow-window dropped panels always had under it (52 under
// the one-row bar's 51), so nothing starts underneath the bar.
import { el } from './dom.js';

const bar = el('topbar');
const fit = () => document.documentElement.style.setProperty(
  '--topbar-h', `${Math.ceil(bar.getBoundingClientRect().height) + 1}px`);
new ResizeObserver(fit).observe(bar);
fit();

// A phone folds the bar's .more items behind ☰ (style.css). A tap outside the bar
// or Escape folds them again; the menus inside keep their own open/close, so an
// Escape with one open only closes it (checked in the capture phase, before the
// menu's own handler hides it). Focus inside a folded item moves to ☰.
const more = el('more-btn');
const setMore = (open) => {
  if (!open && document.activeElement?.closest('#topbar > .more')) more.focus();
  bar.classList.toggle('more-open', open);
  more.setAttribute('aria-expanded', String(open));
};
more.addEventListener('click', () => setMore(!bar.classList.contains('more-open')));
document.addEventListener('pointerdown', (e) => {
  if (bar.classList.contains('more-open') && !bar.contains(e.target)
      && !e.target.closest('.menu')) setMore(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !bar.classList.contains('more-open')) return;
  if (!bar.querySelector('.menu:not([hidden])')) setMore(false);
}, true);
