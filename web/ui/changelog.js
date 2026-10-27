/**
 * "What's new" on the landing card, and the version in the footer line.
 *
 * Reads web/changelog.json from this origin (nothing leaves the machine) and shows the
 * newest entries. Missing, offline or malformed: the card just has no section.
 */
import { latest } from '../changelog.js';
import { t } from './i18n.js';

export const RELEASES_URL = 'https://github.com/gittrahan/support-fins/releases';
const SHOWN = 4;

export async function loadChangelog() {
  const box = document.getElementById('whatsnew');
  if (!box) return;
  let entries;
  try {
    const res = await fetch('changelog.json');
    if (!res.ok) return;
    entries = latest(await res.json(), SHOWN);
  } catch { return; }
  if (!entries.length) return;
  const list = box.querySelector('ul');
  list.replaceChildren(...entries.map((e) => {
    const li = document.createElement('li');
    const v = document.createElement('strong');
    v.textContent = `v${e.version}`;
    li.append(v, ` ${e.date}  ${e.text}`);   // entries stay English
    return li;
  }));
  box.querySelector('.ver').textContent = `v${entries[0].version}`;
  box.hidden = false;
  const ver = document.getElementById('brand-ver');
  if (ver) { ver.textContent = `v${entries[0].version}`; ver.hidden = false; }
}
