/**
 * The pictures behind ui/tips.js: one small side-view diagram per setting that is
 * easier shown than told (GH #351). Plain SVG strings in the scene's own colours --
 * the part blue, supports green, overhangs red, the plate grey, measurements in the
 * accent -- styled by the .tp-* classes in style.css. No words in them, so nothing
 * here needs translating: the text under each picture is the setting's own title.
 *
 * Every picture is 240 x 130 with the plate along y = 118.
 */

const BED = '<line class="tp-bed" x1="8" y1="118" x2="232" y2="118"/>';

// a vertical double-headed measurement from (x, y0) to (x, y1)
const vArrow = (x, y0, y1) =>
  `<line class="tp-dim" x1="${x}" y1="${y0}" x2="${x}" y2="${y1}"/>`
  + `<path class="tp-dim-head" d="M${x - 3} ${y0 + 5} L${x} ${y0} L${x + 3} ${y0 + 5}M${x - 3} ${y1 - 5} L${x} ${y1} L${x + 3} ${y1 - 5}"/>`;
// a horizontal one from (x0, y) to (x1, y)
const hArrow = (x0, x1, y) =>
  `<line class="tp-dim" x1="${x0}" y1="${y}" x2="${x1}" y2="${y}"/>`
  + `<path class="tp-dim-head" d="M${x0 + 5} ${y - 3} L${x0} ${y} L${x0 + 5} ${y + 3}M${x1 - 5} ${y - 3} L${x1} ${y} L${x1 - 5} ${y + 3}"/>`;

// short horizontal tines from the brace edge x(y) to the part edge, every `step` up
function tines(edgeX, partX, y0, y1, step) {
  let s = '';
  for (let y = y0; y >= y1; y -= step) s += `<line class="tp-tine" x1="${edgeX(y)}" y1="${y}" x2="${partX(y)}" y2="${y}"/>`;
  return s;
}

const svg = (body) =>
  `<svg viewBox="0 0 240 130" width="240" height="130" aria-hidden="true" focusable="false">${body}</svg>`;

export const TIP_PICS = {
  // Sway braces: a tapered rib standing out from an upright side, its foot on the
  // plate, tied on with tines all the way up.
  sway: svg(BED
    + '<rect class="tp-part" x="70" y="10" width="40" height="108"/>'
    + '<path class="tp-sup" d="M112 118 L160 118 L114 16 L112 16 Z"/><rect class="tp-sup" x="110" y="115" width="56" height="3"/>'
    + tines(() => 112, () => 110, 112, 22, 9)),

  // Brace grip from: no tines below the height set; they start there and run up.
  'sway-from': svg(BED
    + '<rect class="tp-part" x="40" y="14" width="30" height="104"/>'
    + '<path class="tp-sup" d="M72 118 L102 118 L74 20 L72 20 Z"/><rect class="tp-sup" x="70" y="115" width="38" height="3"/>'
    + tines(() => 72, () => 70, 64, 24, 8)
    + '<line class="tp-mark" x1="30" y1="68" x2="130" y2="68"/>'
    + vArrow(150, 68, 118)),

  // Brace tine spacing: the distance between two tines up the side.
  'sway-spacing': svg(BED
    + '<rect class="tp-part" x="60" y="6" width="50" height="112"/>'
    + '<rect class="tp-sup" x="114" y="6" width="22" height="112"/>'
    + tines(() => 114, () => 110, 106, 14, 30)
    + '<line class="tp-mark" x1="110" y1="46" x2="170" y2="46"/><line class="tp-mark" x1="110" y1="76" x2="170" y2="76"/>'
    + vArrow(160, 46, 76)),

  // Brace depth: how far the rib reaches out at the plate -- shallow (left) and deep.
  'sway-depth': svg(BED
    + '<rect class="tp-part" x="18" y="14" width="22" height="104"/>'
    + '<path class="tp-sup" d="M42 118 L58 118 L44 20 L42 20 Z"/>'
    + hArrow(42, 58, 126)
    + '<rect class="tp-part" x="128" y="14" width="22" height="104"/>'
    + '<path class="tp-sup" d="M152 118 L212 118 L154 20 L152 20 Z"/>'
    + hArrow(152, 212, 126)),

  // Support gap: the air between a support's top and the overhang it holds.
  gap: svg(BED
    + '<path class="tp-part" d="M20 20 L220 20 L220 52 L20 52 Z"/>'
    + '<line class="tp-over" x1="20" y1="52" x2="220" y2="52"/>'
    + '<path class="tp-sup" d="M96 118 L144 118 L144 74 L124 64 L116 64 L96 74 Z"/>'
    + vArrow(170, 52, 64)
    + '<line class="tp-mark" x1="116" y1="64" x2="182" y2="64"/>'),

  // Tines: one-layer bridges from the wall into the part, so the support grips it
  // and snaps off clean.
  tines: svg(BED
    + '<path class="tp-part" d="M40 118 L40 20 L200 20 L200 44 L90 44 L90 118 Z"/>'
    + '<line class="tp-over" x1="90" y1="44" x2="200" y2="44"/>'
    + '<path class="tp-sup" d="M96 118 L112 118 L112 52 L106 50 L102 50 L96 52 Z"/><rect class="tp-sup" x="92" y="115" width="24" height="3"/>'
    + tines(() => 96, () => 90, 108, 56, 8)),
};
