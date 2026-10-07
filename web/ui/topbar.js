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
