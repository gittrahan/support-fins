// Bambu triangle annotations encode a subdivision tree in reverse hexadecimal
// nibble order. Regions are expressed in the ORIGINAL triangle's coordinates:
// (0,0), (1,0), (0,1). These are categorical states, never interpolated RGB.
// Format reference: BambuStudio v02.08.02.60, FacetsAnnotation serialization
// and TriangleSelector::serialize/deserialize/perform_split.

const midpoint = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const area2 = ([a, b, c]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

function children(triangle, sides, special) {
  const [a, b, c] = [0, 1, 2].map((i) => triangle[(i + special) % 3]);
  if (sides === 1) {
    const m = midpoint(b, c);
    return [[a, b, m], [m, c, a]];
  }
  const ab = midpoint(a, b), ca = midpoint(c, a);
  if (sides === 2) return [[a, ab, ca], [ab, b, ca], [b, c, ca]];
  const bc = midpoint(b, c);
  return [[a, ab, ca], [ab, b, bc], [bc, c, ca], [ab, bc, ca]];
}

/** Decode exact leaf regions and their states. Zero means inherited/unpainted.
 * maxState is the project's filament count, or 2 for support/seam annotations.
 * Iterative parsing bounds work by the input size, avoiding recursive stacks.
 * Invalid, truncated or geometrically unrepresentable data is never ignored. */
export function decodePaint(code, maxState = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(maxState) || maxState < 0) throw new Error('invalid paint state limit');
  if (typeof code !== 'string' || !/^[0-9A-Fa-f]*$/.test(code)) {
    throw new Error('invalid hexadecimal paint data');
  }
  const triangle = [[0, 0], [1, 0], [0, 1]];
  if (!code) return [{ triangle, state: 0 }];
  let at = code.length;
  const next = () => {
    if (!at) throw new Error('truncated paint tree');
    return Number.parseInt(code[--at], 16);
  };
  const stack = [triangle], leaves = [];
  while (stack.length) {
    const triangle = stack.pop(), nibble = next(), sides = nibble & 3, special = nibble >> 2;
    if (sides) {
      if (special > 2 || (sides === 3 && special !== 0)) throw new Error('invalid paint split orientation');
      const split = children(triangle, sides, special);
      if (split.some((t) => area2(t) <= 0)) throw new Error('paint subdivision exceeds coordinate precision');
      // Serialized children run from last to first; a LIFO stack does the same.
      stack.push(...split);
    } else {
      let state = special;
      if (state === 3) {
        let extension;
        do {
          extension = next();
          state += extension;
        } while (extension === 15);
      }
      if (!Number.isSafeInteger(state) || state > maxState) {
        throw new Error(`paint refers to unavailable state ${state}`);
      }
      leaves.push({ triangle, state });
    }
  }
  if (at) throw new Error('trailing data after paint tree');
  return leaves;
}

/** One whole output triangle in a categorical state. State 0 is returned as
 * "0"; exporters may omit the attribute to retain the normal inheritance. */
export function encodePaintState(state) {
  if (!Number.isSafeInteger(state) || state < 0) throw new Error('invalid paint state');
  if (state < 3) return (state * 4).toString(16).toUpperCase();
  const n = state - 3;
  return (n % 15).toString(16).toUpperCase() + 'F'.repeat(Math.floor(n / 15)) + 'C';
}
