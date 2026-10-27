/**
 * "Something didn't get supported?" under the status readout (local issue 064): a
 * link that opens a GitHub issue filled in with the build on screen, and Copy
 * settings, the same JSON on the clipboard. The math is web/report.js; this is the
 * page's side -- what the build on screen was, and when there is one to report.
 */
import { t } from './i18n.js';
import { el } from './dom.js';
import { part, rotM3, threshold } from './part.js';
import { builtRequest } from './finbuild.js';
import { scaleState } from './scale.js';
import { drawnWalls } from './walls.js';
import { removedIds } from './remove.js';
import { reportSettings, reportCoverage, reportUrl } from '../report.js';

/** The report of the build on screen, or null when there is none to report. */
function current() {
  const b = builtRequest();
  if (!part || !b) return null;
  const bb = part.geometry.boundingBox;
  const rep = reportSettings({
    threshold, rot: rotM3.elements, opts: b.opts, scale: scaleState().scale,
    size: [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z],
    faces: part.geometry.getAttribute('position').count / 3,
  });
  return { rep, cov: reportCoverage(b.built, b.result) };
}

/** Shown once a build is on screen (ui/readout.js updateReadout calls this). */
export function syncReport() {
  el('report-row').hidden = !builtRequest();
}

el('report-link').addEventListener('click', () => {
  const r = current();
  if (!r) return;
  const url = reportUrl(r.rep, r.cov, {
    where: location.host || 'local file', when: new Date().toISOString().slice(0, 10),
    drawn: drawnWalls.filter((w) => w.ok).length, removed: removedIds.size,
  });
  window.open(url, '_blank', 'noopener');
});

el('report-copy').addEventListener('click', async () => {
  const r = current();
  if (!r) return;
  const btn = el('report-copy');
  try {
    await navigator.clipboard.writeText(JSON.stringify(r.rep, null, 2));
    btn.textContent = t('Copied');
  } catch {
    btn.textContent = t('Copy failed');
  }
  setTimeout(() => { btn.textContent = t('Copy settings'); }, 1500);
});
