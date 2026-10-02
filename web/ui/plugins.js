// Plugins menu: the topbar's download list for every slicer / CAD plugin.
//
// The files are the rolling `plugins-latest` GitHub release, rebuilt by
// .github/workflows/plugins.yml on every push to main that touches web/ or
// plugins/, so a link here always gets the engine this site runs. Download links
// are plain <a href>s (GitHub's download URLs send no CORS headers, but a
// navigation doesn't need them). The version line under each plugin is the asset's
// label ("Fusion add-in 0.6.2 · engine 28ed79c", written by
// plugins/shared/release_labels.py), read through the GitHub API, which IS
// CORS-open; fetched once, the first time the menu opens, and left out if it fails.
//
// Cura, Blender and FreeCAD carry a V8 library, so they ship one file per
// computer; one "Your computer" picker (guessed from the browser) chooses for all.
import { el } from './dom.js';

const REPO = 'gittrahan/support-fins';
const TAG = 'plugins-latest';
const DOWNLOAD = `https://github.com/${REPO}/releases/download/${TAG}/`;
const API = `https://api.github.com/repos/${REPO}/releases/tags/${TAG}`;

// Your-computer choices. Each per-platform plugin maps these to its own file name.
const COMPUTERS = [
  ['mac-arm64', 'macOS (Apple silicon)'],
  ['mac-x64', 'macOS (Intel)'],
  ['windows-x64', 'Windows'],
  ['linux-x64', 'Linux (x86-64)'],
  ['linux-arm64', 'Linux (ARM64)'],
];

// Blender names its platforms macos-*; it ships no Linux ARM build.
const BLENDER = { 'mac-arm64': 'macos-arm64', 'mac-x64': 'macos-x64', 'windows-x64': 'windows-x64', 'linux-x64': 'linux-x64' };

// file: a name, or (computer) => name / null when there's no build for it.
const PLUGINS = [
  {
    name: 'OrcaSlicer', needs: '2.5 nightly or newer · experimental',
    file: 'support_fins_orca.py',
    install: 'Plugins ▸ Install plugin, pick the .py and tick it. Process settings ▸ Advanced ▸ Others ▸ Slicing Pipeline Plugin ▸ Add plugin ▸ Support Fins. Slice; answer Yes to the first slice\'s permission prompts.',
  },
  {
    name: 'PrusaSlicer', needs: '3.0 alpha · for tilted parts · you place each fin by hand',
    // a warning line under the row: what a user must know before downloading
    note: 'Adds one angled fin that you set under a tilted part. PrusaSlicer\'s plugins can\'t read the part\'s mesh, so it isn\'t shaped to the part like the other plugins. New in 0.2.0; not yet confirmed in a running slicer.',
    file: 'support-fins-prusa.zip',
    install: 'Unzip, copy com.printfins.support-fins into the lua folder beside PrusaSlicer.ini, restart. Menu Support Fins ▸ Add a Fin: set Slope Angle to the underside\'s angle, then move the fin so its slope sits 0.2 mm under the part.',
  },
  {
    name: 'Cura', needs: '5.x · experimental',
    file: (c) => `SupportFins-${c}.curapackage`,
    install: 'Drag the .curapackage onto Cura and restart. Select a part, Extensions ▸ Support Fins ▸ Add Support Fins.',
  },
  {
    name: 'Fusion', needs: 'Windows + macOS · experimental',
    file: 'SupportFins.zip',
    install: 'Unzip. Utilities ▸ Add-Ins ▸ Scripts and Add-Ins ▸ + ▸ pick the folder, Run (tick Run on Startup). Solid ▸ Create ▸ Insert Support Fins.',
  },
  {
    name: 'Blender', needs: '4.2 or newer · experimental',
    file: (c) => (BLENDER[c] ? `support_fins-${BLENDER[c]}.zip` : null),
    install: 'Edit ▸ Preferences ▸ Get Extensions ▸ ⌄ ▸ Install from Disk, pick the zip. Sidebar (N) ▸ Support Fins ▸ Add.',
  },
  {
    name: 'FreeCAD', needs: '1.0 · experimental · parametric: recomputes when the part changes',
    file: (c) => `support-fins-freecad-${c}.zip`,
    install: 'Unzip into the Mod folder of FreeCAD\'s user data folder (Help ▸ About shows it) and restart. Toolbar ▸ Add Support Fins.',
  },
  {
    name: 'Onshape', needs: 'custom feature (its own port of the engine)',
    link: 'https://cad.onshape.com/documents/607917e8e297a68eb42cfb58',
    linkText: 'Open in Onshape',
    guide: `https://raw.githubusercontent.com/${REPO}/main/plugins/onshape/SupportFins_User_Guide.pdf`,
    install: 'Any Part Studio ▸ Custom features ▸ Add custom features ▸ Fin Supports document ▸ Support-Fins FS, then select the part.',
  },
  {
    name: 'Command line', needs: 'Deno or Node 20.10+ · fins a whole folder; the Bambu Studio answer',
    file: 'support-fins.mjs',
    install: 'node support-fins.mjs part.stl (or deno run -RW support-fins.mjs part.stl) → part-fins.3mf, part + fins. --help lists every setting.',
  },
];

// Best guess at the visitor's computer. Safari can't tell an Intel Mac from an
// Apple-silicon one, so a Mac defaults to Apple silicon (what Macs have shipped
// since 2020); the picker fixes a wrong guess.
async function guessComputer() {
  const ua = navigator.userAgent;
  let arch = '';
  try {
    arch = (await navigator.userAgentData?.getHighEntropyValues(['architecture']))?.architecture || '';
  } catch { /* not offered: guess from the platform alone */ }
  if (/Mac/.test(ua)) return arch === 'x86' ? 'mac-x64' : 'mac-arm64';
  if (/Windows/.test(ua)) return 'windows-x64';
  if (/Linux|X11/.test(ua)) return arch === 'arm' || /aarch64|arm64/i.test(ua) ? 'linux-arm64' : 'linux-x64';
  return 'windows-x64';
}

const btn = el('plugins');
const panel = el('plugins-menu');
const computer = el('plugins-computer');
const list = el('plugins-list');
let labels = null;      // asset name -> label, once fetched

// "Cura plugin 0.1.0 · mac-arm64 · engine 28ed79c" -> "v0.1.0 · engine 28ed79c": the
// row already names the plugin and the picker the platform.
function shortLabel(label) {
  const [first, ...rest] = label.split(' · ');
  const v = first.match(/(\d[\w.-]*)$/);
  return [v && `v${v[1]}`, ...rest.filter((p) => p.startsWith('engine'))].filter(Boolean).join(' · ');
}

function render() {
  const c = computer.value;
  list.replaceChildren(...PLUGINS.map((p) => {
    const row = document.createElement('div');
    row.className = 'plugin';
    const head = document.createElement('div');
    head.className = 'plugin-head';
    const name = document.createElement('b');
    name.textContent = p.name;
    head.append(name);
    const file = typeof p.file === 'function' ? p.file(c) : p.file;
    const go = document.createElement('a');
    go.className = 'btn sm';
    if (p.link) {
      go.href = p.link;
      go.target = '_blank';
      go.rel = 'noopener';
      go.textContent = p.linkText;
    } else if (file) {
      go.href = DOWNLOAD + file;
      go.textContent = 'Download';
      go.title = file;
    }
    if (go.href) head.append(go);
    if (p.guide) {
      const guide = document.createElement('a');
      guide.className = 'btn sm';
      guide.href = p.guide;
      guide.target = '_blank';
      guide.rel = 'noopener';
      guide.textContent = 'Guide (PDF)';   // raw.githubusercontent serves it as a file, so it downloads
      head.append(guide);
    }
    const needs = document.createElement('div');
    needs.className = 'plugin-needs';
    needs.textContent = file === null ? `No build for ${COMPUTERS.find(([k]) => k === c)[1]}` : p.needs;
    row.append(head, needs);
    if (p.note) {
      const note = document.createElement('div');
      note.className = 'plugin-note';
      note.textContent = p.note;
      row.append(note);
    }
    const label = file && labels?.[file];
    if (label) {
      const ver = document.createElement('div');
      ver.className = 'plugin-ver';
      ver.textContent = shortLabel(label);
      row.append(ver);
    }
    if (file !== null) {
      const how = document.createElement('div');
      how.className = 'plugin-how';
      how.textContent = p.install;
      row.append(how);
    }
    return row;
  }));
}

async function fetchLabels() {
  if (labels) return;
  labels = {};
  try {
    const res = await fetch(API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return;
    for (const a of (await res.json()).assets || []) if (a.label) labels[a.name] = a.label;
    render();
  } catch { /* offline or rate-limited: the downloads still work, just unversioned */ }
}

function setOpen(open) {
  panel.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  if (open) {
    // the menus close each other on pointerdown only; a keyboard open must too
    el('export-menu').hidden = true;
    el('export').setAttribute('aria-expanded', 'false');
    fetchLabels();
    computer.focus();
  }
}

for (const [key, text] of COMPUTERS) computer.add(new Option(text, key));
computer.addEventListener('change', render);
let picked = false;
computer.addEventListener('change', () => { picked = true; }, { once: true });
guessComputer().then((c) => { if (!picked) { computer.value = c; render(); } });
render();

btn.addEventListener('click', () => setOpen(panel.hidden));
el('export').addEventListener('click', () => { if (!panel.hidden) setOpen(false); });
// click-away / Esc close it, like the Export menu
document.addEventListener('pointerdown', (e) => {
  if (!panel.hidden && !e.target.closest('.plugins-wrap')) setOpen(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !panel.hidden) { setOpen(false); btn.focus(); }
});
