// Locate geometric preflight findings without changing or removing supports.
import * as THREE from 'three';
import { supportFindings } from '../fins/diagnostics.js';
import { scene, requestRender, MODEL, clip } from './scene.js';
import { el } from './dom.js';
import { t } from './i18n.js';

let report = null, findings = [], selected = -1, outline = null;
function clearOutline() {
  if (!outline) return;
  scene.remove(outline); outline.geometry.dispose(); outline.material.dispose(); outline = null;
  requestRender();
}
function show() {
  clearOutline();
  const finding = findings[selected];
  el('support-finding-toggle').textContent = t(finding ? 'Hide findings' : 'Show findings');
  el('support-finding-toggle').setAttribute('aria-expanded', String(!!finding));
  el('support-finding-location').hidden = !finding;
  for (const id of ['support-finding-prev', 'support-finding-next']) el(id).hidden = !finding || findings.length < 2;
  if (!finding) { el('support-finding-location').textContent = ''; return; }
  const kind = t({ start: 'Unsupported start', narrow: 'Narrow section', growth: 'Rapid growth' }[finding.kind]);
  const [x0, y0, x1, y1] = finding.bounds;
  const id = finding.piece === 'pad' ? t('Pad') : finding.piece;
  el('support-finding-location').textContent = t('Finding {n} of {total}: {kind}; support {id}, Z {z} mm.',
    { n: selected + 1, total: findings.length, kind, id, z: finding.printZ.toFixed(2) }) + ' '
    + t('X {x0}–{x1} mm, Y {y0}–{y1} mm.', { x0: x0.toFixed(2), x1: x1.toFixed(2), y0: y0.toFixed(2), y1: y1.toFixed(2) });
  const height = finding.layer === 0 ? report.context.firstLayerHeight : report.context.layerHeight;
  outline = new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(x0, y0, finding.z - height),
    new THREE.Vector3(x1, y1, finding.z)), 0xffa828);
  outline.name = 'support-finding';
  outline.layers.disable(MODEL);
  outline.material.depthTest = false; outline.material.clippingPlanes = clip;
  outline.renderOrder = 10;
  scene.add(outline); requestRender();
}

export function syncSupportFindings(next) {
  if (next !== report) { report = next; findings = supportFindings(next); selected = -1; }
  el('support-findings').hidden = !findings.length;
  show();
}

el('support-finding-toggle').addEventListener('click', () => { selected = selected < 0 ? 0 : -1; show(); });
for (const [id, delta] of [['support-finding-prev', -1], ['support-finding-next', 1]]) {
  el(id).addEventListener('click', () => {
    if (!findings.length) return;
    selected = (selected + delta + findings.length) % findings.length; show();
  });
}
