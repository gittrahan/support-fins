/**
 * TIP CARDS (GH #351): every setting's tooltip shows in a card, with a small diagram
 * for the settings that are easier shown than told, for anyone reading the tooltips
 * in a second language.
 *
 * Any element with a `title` in the settings panel (#fin-opts) gets the card; one
 * with data-tip-pic="<key>" (a picture in ui/tippics.js) gets it anywhere, picture
 * on top. The text stays the element's own `title`, translated by ui/i18n.js as
 * before; this only shows it in a card instead of the browser's plain tooltip.
 * Titles outside the panel are left to the browser.
 *
 * The native tooltip would pop up over the card, so while the card is up the title
 * is parked in data-tip-title and put back when it goes. Anything that sets the
 * title meanwhile (a language switch) wins: the parked copy is only restored when
 * nothing has replaced it.
 *
 * Shown on hover (after a short delay), on keyboard focus, and on a long press on a
 * touch screen, where a title never shows at all. Escape or a press elsewhere hides it.
 */
import { TIP_PICS } from './tippics.js';

const SCOPE = '#fin-opts';
const HOVER_MS = 350;
const PRESS_MS = 450;
const GUTTER = 16;

const card = document.createElement('div');
card.className = 'tip-card';
card.id = 'tip-card';
card.setAttribute('role', 'tooltip');
card.hidden = true;
document.body.appendChild(card);

let owner = null;    // the element the card is showing for
let timer = 0;
let pressed = null;  // shown by a long press: its click (the finger lifting) is swallowed
let byKey = false;   // was the last input a key? Chrome counts any focus of a text or
                     // number field as :focus-visible, a click or a tap included

const textOf = (el) => el.getAttribute('title') ?? el.dataset.tipTitle ?? '';

function park(el) {
  if (el.hasAttribute('title')) {
    el.dataset.tipTitle = el.getAttribute('title');
    el.removeAttribute('title');
  }
}

function unpark(el) {
  if (!el.hasAttribute('title') && el.dataset.tipTitle != null) el.setAttribute('title', el.dataset.tipTitle);
  delete el.dataset.tipTitle;
}

function place(el) {
  const r = el.getBoundingClientRect();
  const w = card.offsetWidth, h = card.offsetHeight;
  const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
  // beside the settings rail (left of it) when there's room, else below or above
  let x = r.left - w - 10, y = r.top + r.height / 2 - h / 2;
  if (x < GUTTER) {
    x = Math.min(Math.max(GUTTER, r.left), vw - w - GUTTER);
    y = r.bottom + 8 + h <= vh - GUTTER ? r.bottom + 8 : r.top - 8 - h;
  }
  y = Math.min(Math.max(GUTTER, y), vh - h - GUTTER);
  card.style.left = `${Math.max(GUTTER, x)}px`;
  card.style.top = `${y}px`;
}

function show(el) {
  clearTimeout(timer);
  if (owner && owner !== el) hide();
  const pic = TIP_PICS[el.dataset.tipPic] ?? '';
  const text = textOf(el).trim();
  if (!pic && !text) return;
  owner = el;
  park(el);
  card.innerHTML = pic;
  card.classList.toggle('plain', !pic);
  if (text) {
    const p = document.createElement('p');
    p.textContent = text;
    card.appendChild(p);
  }
  card.hidden = false;
  el.setAttribute('aria-describedby', card.id);
  place(el);
}

function hide() {
  clearTimeout(timer);
  if (!owner) return;
  unpark(owner);
  owner.removeAttribute('aria-describedby');
  owner = null;
  card.hidden = true;
}

// the innermost element with a tip: a picture, or a title in the settings panel
// (data-tip-title is a title parked while its card is up)
function tipOf(target) {
  if (!(target instanceof Element)) return null;
  const el = target.closest('[data-tip-pic], [title], [data-tip-title]');
  return el && (el.dataset.tipPic || el.closest(SCOPE)) ? el : null;
}

document.addEventListener('pointerover', (e) => {
  if (e.pointerType === 'touch') return;
  const el = tipOf(e.target);
  if (!el || el === owner) return;
  clearTimeout(timer);
  // park now, or the browser's own tooltip beats the card to it
  park(el);
  timer = setTimeout(() => show(el), HOVER_MS);
});

document.addEventListener('pointerout', (e) => {
  if (e.pointerType === 'touch') return;
  const el = tipOf(e.target);
  if (!el || el.contains(e.relatedTarget)) return;
  if (el === owner) hide();
  else { clearTimeout(timer); unpark(el); }
});

document.addEventListener('focusin', (e) => {
  const el = tipOf(e.target);
  if (el && byKey && e.target.matches(':focus-visible')) show(el);
});
document.addEventListener('focusout', (e) => {
  const el = tipOf(e.target);
  if (el && el === owner && !el.contains(e.relatedTarget)) hide();
});

// touch: a long press shows it; any later press hides it
document.addEventListener('pointerdown', (e) => {
  byKey = false;
  pressed = null;    // Android sends no click after a long press, so a stale one goes here
  const el = tipOf(e.target);
  if (owner && owner !== el) hide();
  if (e.pointerType !== 'touch' || !el) return;
  clearTimeout(timer);
  timer = setTimeout(() => { show(el); pressed = el; }, PRESS_MS);
});
document.addEventListener('click', (e) => {
  if (pressed && pressed.contains(e.target)) { e.preventDefault(); e.stopPropagation(); }
  pressed = null;
}, true);
for (const ev of ['pointerup', 'pointercancel']) {
  // a tap that lifts before the long press is just a tap, card up or not
  document.addEventListener(ev, (e) => { if (e.pointerType === 'touch') clearTimeout(timer); });
}

// Android's long press would also open the text-selection menu over the card
document.addEventListener('contextmenu', (e) => { if (tipOf(e.target) && pressed) e.preventDefault(); });

document.addEventListener('keydown', (e) => { byKey = true; if (e.key === 'Escape') hide(); });
// a scroll (focus moving into the settings rail scrolls it) carries the card along,
// and hides it once its setting is off screen
addEventListener('scroll', () => {
  if (!owner) return;
  const r = owner.getBoundingClientRect();
  if (r.bottom < 0 || r.top > document.documentElement.clientHeight || !r.height) hide();
  else place(owner);
}, true);
addEventListener('resize', hide);
