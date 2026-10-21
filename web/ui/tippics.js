/**
 * The pictures behind ui/tips.js: one small diagram per setting (GH #351), side views
 * unless a setting is about the plan (Long walls, Curved walls: seen from above).
 * Plain SVG strings in the scene's own colours -- the part blue, supports green,
 * overhangs red, the plate grey, measurements in the accent -- styled by the .tp-* classes in style.css. No words in them, so nothing
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

// a support wall standing on the plate from x0 to x1, its top at y with the usual
// chamfered contact tip
const wall = (x0, x1, y, cls = 'tp-sup') =>
  `<path class="${cls}" d="M${x0} 118 L${x1} 118 L${x1} ${y + 4} L${x1 - 4} ${y} L${x0 + 4} ${y} L${x0} ${y + 4} Z"/>`;
// a flat overhang: the part as a slab from x0 to x1 whose underside (red) is at y
const slab = (x0, x1, y0, y) =>
  `<rect class="tp-part" x="${x0}" y="${y0}" width="${x1 - x0}" height="${y - y0}"/>`
  + `<line class="tp-over" x1="${x0}" y1="${y}" x2="${x1}" y2="${y}"/>`;
// a mouse pointer with its tip at (x, y)
const cursor = (x, y) =>
  `<path class="tp-cursor" d="M${x} ${y} L${x} ${y + 20} L${x + 5} ${y + 15} L${x + 9} ${y + 24} L${x + 13} ${y + 22} L${x + 9} ${y + 13} L${x + 16} ${y + 13} Z"/>`;
// a cross: removed, or not supported
const cross = (x, y, r = 7) =>
  `<path class="tp-x" d="M${x - r} ${y - r} L${x + r} ${y + r} M${x + r} ${y - r} L${x - r} ${y + r}"/>`;
// a part tilted onto one edge, the edge on the plate at x
const tilted = (x) => `<path class="tp-part" d="M${x} 118 L${x + 57} 78 L${x + 17} 21 L${x - 40} 61 Z"/>`;
// one cross-section bead of extruded plastic
const bead = (x, y) => `<ellipse class="tp-bead" cx="${x}" cy="${y}" rx="5" ry="3.5"/>`;
// a column of beads `wide` lines wide, from y0 (the plate's first layer) up to y
function beads(cx, wide, y, y0 = 114) {
  let s = '';
  for (let yy = y0; yy >= y; yy -= 7) for (let i = 0; i < wide; i++) s += bead(cx + (i - (wide - 1) / 2) * 10, yy);
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

  // Printer (the summary row): the nozzle laying a wall down a layer at a time.
  printer: svg(BED
    + '<path class="tp-tool" d="M96 6 L144 6 L144 28 L130 28 L123 42 L117 42 L110 28 L96 28 Z"/>'
    + beads(120, 2, 50)),

  // Nozzle: the opening sets a line's width; a wall is two lines.
  nozzle: svg(BED
    + '<path class="tp-tool" d="M70 4 L170 4 L170 26 L134 26 L126 46 L114 46 L106 26 L70 26 Z"/>'
    + hArrow(114, 126, 54)
    + beads(120, 2, 72)
    + hArrow(110, 130, 126)),

  // Layer height: a tine is one layer tall, so it has to match the slicer's layer.
  'layer-height': svg(BED
    + '<rect class="tp-part" x="40" y="10" width="60" height="108"/>'
    + '<rect class="tp-sup" x="140" y="22" width="36" height="96"/>'
    + [106, 94, 82, 70, 58, 46, 34].map((y) => `<line class="tp-layer" x1="140" y1="${y}" x2="176" y2="${y}"/>`).join('')
    + '<rect class="tp-sup" x="100" y="58" width="40" height="12"/>'
    + '<line class="tp-mark" x1="176" y1="58" x2="214" y2="58"/><line class="tp-mark" x1="176" y1="70" x2="214" y2="70"/>'
    + vArrow(204, 58, 70)),

  // Interface material: each wall's top layer (purple) in a second material.
  iface: svg(BED
    + slab(20, 220, 18, 50)
    + '<rect class="tp-sup" x="60" y="66" width="36" height="52"/><rect class="tp-iface" x="60" y="58" width="36" height="8"/>'
    + '<rect class="tp-sup" x="144" y="66" width="36" height="52"/><rect class="tp-iface" x="144" y="58" width="36" height="8"/>'),

  // Tine grip: Light (few tines) and Firm (a dense comb).
  'tine-density': svg(BED
    + '<rect class="tp-part" x="20" y="10" width="44" height="108"/><rect class="tp-sup" x="70" y="10" width="16" height="108"/>'
    + tines(() => 70, () => 64, 100, 20, 26)
    + '<rect class="tp-part" x="134" y="10" width="44" height="108"/><rect class="tp-sup" x="184" y="10" width="16" height="108"/>'
    + tines(() => 184, () => 178, 112, 14, 7)),

  // Direction: horizontal tines into a side (FDM), or vertical pins up from the wall
  // top, across the gap and a little into the underside (resin).
  'tine-dir': svg(BED
    + '<rect class="tp-part" x="20" y="10" width="40" height="108"/><rect class="tp-sup" x="66" y="22" width="16" height="96"/>'
    + tines(() => 66, () => 60, 108, 30, 10)
    + slab(126, 226, 16, 52)
    + '<rect class="tp-sup" x="156" y="60" width="40" height="58"/>'
    + [162, 176, 190].map((x) => `<line class="tp-tine" x1="${x}" y1="60" x2="${x}" y2="42"/>`).join('')),

  // Pin depth: how far each pin sinks into the part, past the gap it crosses.
  'pin-depth': svg(BED
    + slab(20, 220, 8, 60)
    + '<rect class="tp-sup" x="84" y="74" width="72" height="44"/>'
    + [96, 116, 136].map((x) => `<rect class="tp-sup" x="${x}" y="42" width="6" height="32"/>`).join('')
    + '<line class="tp-mark" x1="142" y1="42" x2="196" y2="42"/>'
    + vArrow(186, 42, 60)),

  // Cutouts (honeycomb shown): holes through a tall wall, each with a pointed roof
  // so it prints without bridging; the top, foot and ends stay solid.
  cutout: svg(BED
    + slab(16, 224, 4, 18)
    + '<rect class="tp-sup" x="20" y="26" width="200" height="92"/>'
    + [[41, 52],[62, 52],[83, 52],[104, 52],[125, 52],[146, 52],[167, 52],[188, 52],[51.5, 78.9],[72.5, 78.9],[93.5, 78.9],[114.5, 78.9],[135.5, 78.9],[156.5, 78.9],[177.5, 78.9]].map(([x, y]) =>
      `<path class="tp-hole" d="M${x} ${y - 17.9} L${x + 9} ${y - 5} L${x + 9} ${y + 5} L${x} ${y + 17.9} L${x - 9} ${y + 5} L${x - 9} ${y - 5} Z"/>`).join('')),

  // + Add: an extra wall placed by hand beside the automatic ones.
  'add-walls': svg(BED
    + slab(20, 220, 14, 44)
    + wall(40, 56, 52) + wall(184, 200, 52)
    + wall(112, 128, 52, 'tp-hand')
    + cursor(124, 76)),

  // Remove fins: click one fin and only that one goes.
  'remove-fins': svg(BED
    + slab(20, 220, 14, 44)
    + wall(40, 56, 52) + wall(184, 200, 52)
    + wall(112, 128, 52, 'tp-ghost')
    + cursor(124, 76)),

  // Restore all: the removed fins come back.
  'restore-fins': svg(BED
    + slab(8, 108, 20, 46) + wall(28, 40, 54, 'tp-ghost') + wall(76, 88, 54, 'tp-ghost')
    + '<path class="tp-dim" d="M108 82 Q120 66 132 82"/><path class="tp-dim-head" d="M126 79 L132 82 L132 75"/>'
    + slab(132, 232, 20, 46) + wall(152, 164, 54) + wall(200, 212, 54)),

  // Remove selected: the support you clicked (outlined) is taken away.
  'draw-remove': svg(BED
    + slab(20, 220, 14, 44)
    + wall(40, 56, 52)
    + wall(112, 128, 52, 'tp-picked')
    + cross(120, 86)),

  // Bed pad: a tilted part stands on an edge; a thin pad round it holds it down.
  'bed-pad': svg(BED + '<rect class="tp-sup" x="60" y="113" width="124" height="5"/>' + tilted(120)),

  // Pad thickness.
  'pad-h': svg(BED
    + '<rect class="tp-part" x="120" y="16" width="100" height="102"/>'
    + '<rect class="tp-sup" x="20" y="98" width="96" height="20"/>'
    + '<line class="tp-mark" x1="10" y1="98" x2="20" y2="98"/>'
    + vArrow(10, 98, 118)),

  // Pad gap: the sideways clearance between the pad and the part's first layer.
  'pad-gap': svg(BED
    + '<rect class="tp-part" x="130" y="16" width="90" height="102"/>'
    + '<rect class="tp-sup" x="20" y="108" width="96" height="10"/>'
    + '<line class="tp-mark" x1="116" y1="80" x2="116" y2="108"/><line class="tp-mark" x1="130" y1="80" x2="130" y2="108"/>'
    + hArrow(116, 130, 90)),

  // Pad grip: where the pad meets the part's underside -- bites in, flush, gap.
  'pad-grip': svg(BED + [[6, -10], [86, 0], [166, 10]].map(([ox, s]) => {
    const part = `<path class="tp-part" d="M${ox + 6} 118 L${ox + 66} 58 L${ox + 66} 12 L${ox + 6} 12 Z"/>`;
    const pad = `<path class="tp-sup" d="M${ox + 22 + s} 102 L${ox + 72} 102 L${ox + 72} 118 L${ox + 6 + s} 118 Z"/>`;
    return s < 0 ? part + pad : pad + part;
  }).join('')),

  // Pad spread: how far the pad reaches past where the part meets the plate.
  'pad-margin': svg(BED
    + '<rect class="tp-sup" x="50" y="113" width="150" height="5"/>' + tilted(120)
    + hArrow(120, 200, 126)),

  // Wall lines: a wall two lines thick, and four; the contact tip stays one line.
  'wall-lines': svg(BED
    + slab(10, 230, 6, 18)
    + beads(70, 2, 52) + beads(70, 1, 30, 51)
    + beads(170, 4, 52) + beads(170, 1, 30, 51)),

  // Brace tall walls: a tall wall seen end on, with triangular ribs off both faces
  // at the plate.
  'tall-ribs': svg(BED
    + slab(70, 170, 2, 10)
    + '<rect class="tp-sup" x="116" y="16" width="8" height="102"/>'
    + '<path class="tp-sup" d="M116 118 L84 118 L116 50 Z"/><path class="tp-sup" d="M124 118 L156 118 L124 50 Z"/>'),

  // Brace walls above: walls over this height get ribs; shorter ones don't.
  'tall-ribs-height': svg(BED
    + '<rect class="tp-sup" x="56" y="70" width="8" height="48"/>'
    + '<rect class="tp-sup" x="146" y="8" width="8" height="110"/>'
    + '<path class="tp-sup" d="M146 118 L122 118 L146 70 Z"/><path class="tp-sup" d="M154 118 L178 118 L154 70 Z"/>'
    + '<line class="tp-mark" x1="20" y1="50" x2="216" y2="50"/>'
    + vArrow(208, 50, 118)),

  // Full brace depth: past the usual limit (dashed), the brace keeps its share.
  'full-brace-depth': svg(BED
    + '<rect class="tp-part" x="20" y="6" width="22" height="112"/>'
    + '<path class="tp-sup" d="M44 118 L84 118 L46 12 L44 12 Z"/>'
    + '<line class="tp-mark" x1="84" y1="20" x2="84" y2="118"/>'
    + '<rect class="tp-part" x="128" y="6" width="22" height="112"/>'
    + '<path class="tp-sup" d="M152 118 L226 118 L154 12 L152 12 Z"/>'
    + '<line class="tp-mark" x1="192" y1="20" x2="192" y2="118"/>'),

  // Cross-rib height: a brace's cross rib reaches this share of its height.
  'sway-cross-height': svg(BED
    + '<rect class="tp-part" x="30" y="10" width="30" height="108"/>'
    + '<path class="tp-sup" d="M62 118 L130 118 L64 14 L62 14 Z"/>'
    + '<path class="tp-sup2" d="M78 118 L130 118 L95 64 Z"/>'
    + '<line class="tp-mark" x1="95" y1="64" x2="190" y2="64"/><line class="tp-mark" x1="64" y1="14" x2="222" y2="14"/>'
    + vArrow(176, 64, 118) + vArrow(210, 14, 118)),

  // Wide-face coverage: fewer fins under a wide face (left), or more (right).
  coverage: svg(BED
    + slab(8, 114, 16, 44) + wall(26, 38, 52) + wall(84, 96, 52)
    + slab(126, 232, 16, 44) + [132, 152, 172, 192, 212].map((x) => wall(x, x + 12, 52)).join('')),

  // Plate only: supports stand on the plate, never on the part. The shelf and the
  // right of the top hang over the plate and get walls; the top above the shelf
  // has part under it, so it's left.
  'plate-only': svg(BED
    + '<path class="tp-part" d="M20 18 L220 18 L220 36 L134 36 L134 118 L104 118 L104 84 L44 84 L44 72 L104 72 L104 36 L20 36 Z"/>'
    + '<line class="tp-over" x1="20" y1="36" x2="104" y2="36"/><line class="tp-over" x1="134" y1="36" x2="220" y2="36"/>'
    + '<line class="tp-over" x1="44" y1="84" x2="104" y2="84"/>'
    + cross(66, 54)
    + wall(64, 80, 92) + wall(168, 184, 44)),

  // Long walls (seen from above): rows along the part's length (right) instead of
  // short walls under each patch (left).
  'long-walls': svg(
    '<rect class="tp-plan" x="10" y="20" width="104" height="90"/>'
    + [[18, 30], [62, 34], [26, 58], [70, 62], [20, 88], [64, 92]].map(([x, y]) => `<rect class="tp-sup" x="${x}" y="${y}" width="26" height="4"/>`).join('')
    + '<rect class="tp-plan" x="126" y="20" width="104" height="90"/>'
    + [38, 63, 88].map((y) => `<rect class="tp-sup" x="134" y="${y}" width="88" height="4"/>`).join('')),

  // Curved walls (a round part seen from above): walls that bend along its curved
  // rim (right) instead of short straight ones under it (left).
  'curved-walls': svg(
    '<circle class="tp-plan" cx="62" cy="65" r="50"/><circle class="tp-over" fill="none" cx="62" cy="65" r="42"/>'
    + '<path class="tp-band" fill="none" d="M44 29 L80 29 M98 47 L98 83 M80 101 L44 101 M26 83 L26 47"/>'
    + '<circle class="tp-plan" cx="178" cy="65" r="50"/><circle class="tp-over" fill="none" cx="178" cy="65" r="42"/>'
    + '<path class="tp-band" fill="none" d="M178 31 A34 34 0 0 1 212 65 M212 71 A34 34 0 0 1 184 99 M172 99 A34 34 0 0 1 144 71 M144 59 A34 34 0 0 1 172 31"/>'),

  // Highlight small overhangs: an overhang too small for a fin is shaded amber and
  // prints unsupported; the big one gets its fin.
  'highlight-small': svg(BED
    + '<path class="tp-part" d="M30 118 L30 20 L200 20 L200 44 L124 44 L124 64 L100 64 L100 118 Z"/>'
    + '<line class="tp-over" x1="124" y1="44" x2="200" y2="44"/>'
    + '<line class="tp-amber" x1="100" y1="64" x2="124" y2="64"/>'
    + wall(150, 166, 52)),

  // Show midair starts: a spot whose first layer starts in the air (the bottom of a
  // knob) gets a red cone under it.
  'show-islands': svg(BED
    + slab(20, 220, 14, 40).replace(/<line[^>]*>/, '')
    + '<rect class="tp-part" x="112" y="40" width="16" height="12"/><circle class="tp-part" cx="120" cy="64" r="16"/>'
    + '<path class="tp-cone" d="M120 84 L108 108 L132 108 Z"/>'),
};
