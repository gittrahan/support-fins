/**
 * "What's new" on the landing card, and the version in the top bar.
 *
 * Reads web/changelog.json from this origin (nothing leaves the machine). Released entries
 * show under their version; entries merged since the last release show as "Coming next",
 * which the live site never has: printfins.com deploys only a released commit.
 * Missing, offline or malformed: the card just has no section.
 */
import { releases, unreleased } from '../changelog.js';

export const RELEASES_URL = 'https://github.com/gittrahan/support-fins/releases';
const SHOWN = 4;

function item(version, e) {
  const li = document.createElement('li');
  if (version) {
    const v = document.createElement('strong');
    v.textContent = `v${version}`;
    li.append(v, ' ');
  }
  li.append(`${e.date} ${e.text}`);   // entries stay English
  return li;
}

export async function loadChangelog() {
  const box = document.getElementById('whatsnew');
  if (!box) return;
  let data;
  try {
    const res = await fetch('changelog.json');
    if (!res.ok) return;
    data = await res.json();
  } catch { return; }
  const next = unreleased(data).slice(-SHOWN).reverse();
  const done = releases(data).flatMap((r) => [...r.entries].reverse().map((e) => [r.version, e])).slice(0, SHOWN);
  if (!next.length && !done.length) return;
  const nextList = box.querySelector('ul.next');
  nextList.replaceChildren(...next.map((e) => item(null, e)));
  nextList.hidden = box.querySelector('.next-h').hidden = !next.length;
  box.querySelector('ul.done').replaceChildren(...done.map(([v, e]) => item(v, e)));
  const top = releases(data)[0];
  box.querySelector('.ver').textContent = top ? `v${top.version}` : '';
  box.hidden = false;
  // top-bar label: it sits in .brand-text, so it sheds with it on narrow windows and phones
  const ver = document.getElementById('brand-ver');
  if (ver && top) { ver.textContent = `v${top.version}`; ver.hidden = false; }
}
