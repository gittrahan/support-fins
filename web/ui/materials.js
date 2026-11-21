/** Optional material preview and explicit source-to-support filament mapping.
 * Preview meshes never enter generation, exports, face picking or saved geometry. */
import * as THREE from 'three';
import { el } from './dom.js';
import { t } from './i18n.js';
import { clip, requestRender, scene } from './scene.js';
import { lastResult, part } from './part.js';
import { buildPending, finMesh, padMesh } from './finbuild.js';
import { drawnMesh } from './walls.js';
import { finsVisible } from './settings.js';
import { buildExportGeometry } from './export.js';
import { partitionSupportExport } from '../material-worker-client.js';
import {
  browserMaterialOptions,
  mappedSlot,
  MATERIAL_FORM_IDS,
  materialKey,
  materialMapping,
  readPalette,
} from '../browser-materials.js';

let generation = 0, controller, timer, overlays = [], hidden = [];
const field = () => part?.geometry.userData.materialField;
const form = () =>
  Object.fromEntries(
    MATERIAL_FORM_IDS.map((id) => [id, el(id).type === 'checkbox' ? el(id).checked : el(id).value]),
  );
function write(id, value) {
  el(id).value = JSON.stringify(value);
  el(id).dispatchEvent(new Event('change', { bubbles: true }));
}
function status(text) {
  el('material-status').textContent = text;
}
function clear() {
  generation++;
  controller?.abort();
  controller = null;
  clearTimeout(timer);
  for (const m of overlays) {
    scene.remove(m);
    m.geometry.dispose();
    m.material.dispose();
  }
  overlays = [];
  for (const m of hidden) m.visible = true;
  hidden = [];
  requestRender();
}
function paint(triangles, colors, detail = {}) {
  if (!triangles.length) return;
  const g = new THREE.BufferGeometry(),
    pos = new Float32Array(triangles.length * 3),
    rgb = new Float32Array(pos.length),
    color = new THREE.Color();
  triangles.forEach((p, i) => {
    pos.set(p.slice(0, 3), i * 3);
    color.set(colors(i));
    rgb.set([color.r, color.g, color.b], i * 3);
  });
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(
    g,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: .7,
      side: THREE.DoubleSide,
      clippingPlanes: clip,
    }),
  );
  // Default layer only: material overlays cannot become model/fin picking targets.
  m.userData.materialPreview = detail;
  scene.add(m);
  overlays.push(m);
}
async function preview() {
  clear();
  if (
    !el('show-materials').checked || !el('match-contact-materials').checked ||
    el('tine-dir').value === 'vertical' || !part || !finsVisible || buildPending()
  ) return;
  const token = generation, source = part, result = lastResult;
  try {
    const g = buildExportGeometry();
    if (!g) return;
    const options = browserMaterialOptions(g.materialOptions.form, g.materialOptions.field);
    status(t('Matching contact materials…'));
    controller = new AbortController();
    const partition = await partitionSupportExport(g.finTris, options, { signal: controller.signal });
    if (
      token !== generation || part !== source || lastResult !== result || buildPending() || !finsVisible
    ) {
      return;
    }
    // Keep the whole body grey beneath exact painted leaves, including unknown
    // surfaces from new cuts. The leaf overlay avoids a majority-colour face view.
    paint(g.partTris, () => '#bdbdbd', { role: 'source' });
    const colors = new Map(
      (g.materialField?.materials ?? []).map((
        m,
      ) => [
        m.id,
        /^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(m.displayColor) ? m.displayColor.slice(0, 7) : '#bdbdbd',
      ]),
    );
    const regions = g.materialField?.regions ?? [];
    const before = overlays.length;
    paint(
      regions.flatMap((r) => r.triangle),
      (i) => colors.get(regions[Math.floor(i / 3)].material) ?? '#bdbdbd',
      { role: 'source-paint' },
    );
    if (overlays.length > before) {
      const material = overlays.at(-1).material;
      material.polygonOffset = true;
      material.polygonOffsetFactor = -1;
      material.polygonOffsetUnits = -1;
    }
    for (const p of partition.parts) {
      paint(p.triangles, () => options.palette[+p.material.slice(9) - 1].color, {
        role: p.role,
        filament: +p.material.slice(9),
      });
    }
    for (const m of [part, finMesh, padMesh, drawnMesh]) {
      if (m?.visible) {
        hidden.push(m);
        m.visible = false;
      }
    }
    status(
      partition.diagnostics.length
        ? t('Unresolved contacts use fallback filament {n}. Inspect them in the slicer.', {
          n: options.fallbackMaterial.slice(9),
        })
        : t('Contact materials matched. Confirm filament slots in the slicer.'),
    );
    requestRender();
  } catch (error) {
    if (token === generation) status(t(error.message));
  }
}
function schedule() {
  clear();
  timer = setTimeout(preview, 150);
}
function render() {
  const source = field(), f = form();
  el('material-controls').hidden = !f['match-contact-materials'] || el('tine-dir').value === 'vertical';
  if (el('material-controls').hidden) {
    clear();
    return;
  }
  try {
    const palette = readPalette(f['material-palette'], source),
      mapping = materialMapping(f['material-mapping']);
    el('material-body').max = el('material-fallback').max = palette.length;
    const rows = el('material-palette-rows');
    rows.replaceChildren();
    palette.forEach((p, i) => {
      const row = document.createElement('label');
      row.className = 'fld row';
      const label = document.createElement('span');
      label.textContent = t('Filament {n}', { n: i + 1 });
      const color = document.createElement('input');
      color.type = 'color';
      color.value = p.color;
      color.setAttribute('aria-label', label.textContent);
      color.addEventListener('change', () => {
        palette[i] = { ...p, color: color.value };
        write('material-palette', palette);
      });
      row.append(label, color);
      rows.append(row);
    });
    const mapRows = el('material-map-rows');
    mapRows.replaceChildren();
    for (const m of source?.materials ?? []) {
      const row = document.createElement('label');
      row.className = 'fld row';
      const label = document.createElement('span');
      label.textContent = m.kind === 'filament'
        ? t('Source filament {n}', { n: m.slot })
        : m.name || m.id;
      label.title = [m.id, m.name, m.materialType, m.displayColor].filter(Boolean).join(' · ');
      const select = document.createElement('select');
      select.setAttribute('aria-label', label.textContent);
      select.add(new Option(t('Use fallback'), ''));
      palette.forEach((_, i) => select.add(new Option(t('Filament {n}', { n: i + 1 }), String(i + 1))));
      select.value = String(mappedSlot(source, m.id, mapping, palette.length) ?? '');
      select.addEventListener('change', () => {
        write('material-mapping', { ...mapping, [materialKey(source, m.id)]: select.value });
      });
      row.append(label, select);
      mapRows.append(row);
    }
    status(
      source?.regions.length
        ? t('Choose a fallback, then preview or export 3MF.')
        : t('No source material regions are available. Contacts will use the fallback.'),
    );
  } catch (error) {
    status(t(error.message));
  }
  schedule();
}
el('material-add').addEventListener('click', () => {
  try {
    const palette = readPalette(el('material-palette').value, field());
    if (palette.length < 255) {
      write('material-palette', [...palette, {
        color: '#bdbdbd',
        name: `Filament ${palette.length + 1}`,
      }]);
    }
  } catch (error) {
    status(t(error.message));
  }
});
addEventListener('change', (event) => {
  const id = event.target?.id;
  if (id === 'match-contact-materials' && el(id).checked && !el('material-palette').value) {
    try {
      write('material-palette', readPalette('', field()));
    } catch (error) {
      clear();
      status(t(error.message));
      return;
    }
  }
  if (MATERIAL_FORM_IDS.includes(id) || ['show-materials', 'tine-dir', 'material-format'].includes(id)) {
    render();
  }
});
document.addEventListener('materialpreviewinvalidate', clear);
document.addEventListener('supportchange', schedule);
document.addEventListener('partchange', render);
document.addEventListener('partsizechange', schedule);
document.addEventListener(
  'materialwarning',
  ({ detail }) =>
    status(
      t('Unresolved contacts use fallback filament {n}. Inspect them in the slicer.', {
        n: detail.fallback,
      }),
    ),
);

addEventListener('languagechange', render);
