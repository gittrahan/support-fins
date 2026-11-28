// The component puts V8's Math.hypot in QuickJS's place (component/src/lib.rs, hypot):
// QuickJS's own rounds differently in the last bit, and the engine turns a last bit into
// another tine. component/tests/hypot.rs holds the Rust to V8's answers in
// component/tests/hypot-v8.txt; this holds that file to the V8 the tests run on, so a
// change in V8's Math.hypot shows here rather than as fins that differ from the site's.
//
//   deno test -A plugins/solidcraft/tests/
import { assert } from '../../../tests/_util.js';

const FILE = new URL('../component/tests/hypot-v8.txt', import.meta.url);
const f64 = new Float64Array(1);
const bits = new BigUint64Array(f64.buffer);
const number = (hex) => { bits[0] = BigInt(`0x${hex}`); return f64[0]; };

Deno.test('hypot-v8.txt is this V8\'s Math.hypot', () => {
  const lines = Deno.readTextFileSync(FILE).split('\n').filter((l) => l && !l.startsWith('#'));
  let bad = 0;
  for (const line of lines) {
    const [args, want] = [line.slice(0, line.lastIndexOf(' ')), line.slice(line.lastIndexOf(' ') + 1)];
    const values = args ? args.split(',').map(number) : [];
    const got = Math.hypot(...values);
    if (!Object.is(got, number(want)) && bad++ < 5) console.error('differs:', values, got, number(want));
  }
  assert(lines.length > 600, `${lines.length} cases`);
  assert(bad === 0, `${bad} of ${lines.length} differ from Math.hypot: regenerate hypot-v8.txt and check the Rust`);
});
