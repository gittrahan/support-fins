// The one-line result every host shows, from computeFins' stats: what was placed
// and -- quality first -- what wasn't: overhangs too shallow for a fin this way up,
// and pieces that start in mid-air. Same facts as the website's readout
// (web/ui/readout.js), shorter.
//
// Python hosts have the same line in py/supportfins_host.py host_report; keep the
// two word for word (plugins/cli/tests/cli.test.js checks them against each other
// when python3 is on the PATH).

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** @param {object} stats  computeFins(...).stats */
export function reportLine(stats) {
  const walls = (stats.braces || 0) + (stats.props || 0);   // tined + plain, as the site counts
  let head = `${plural(walls, 'wall', 'walls')}, ${plural(stats.tines || 0, 'tine', 'tines')}`;
  // Sway braces hold the tall sides, not an overhang: never added to the walls.
  if (stats.swayBraces) head += `, ${plural(stats.swayBraces, 'sway brace', 'sway braces')}`;
  const parts = [head];
  const unserved = stats.unserved || 0;
  if (unserved) {
    parts.push(`${unserved} overhang${unserved === 1 ? ' is' : 's are'} too shallow `
      + 'for a fin this way up (tilt the part steeper)');
  }
  const floating = stats.floating || 0;
  if (floating) {
    const drop = Number(stats.floatingDrop || 0).toFixed(1);
    parts.push((floating === 1
      ? `one piece isn't joined to the rest: it starts ${drop} mm up`
      : `${floating} pieces aren't joined to the rest: the first starts ${drop} mm up`)
      + ', held only by supports');
  }
  return parts.join('; ');
}
