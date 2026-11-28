//! The component's Math.hypot is V8's, bit for bit, on V8's own answers for inputs like
//! the engine's (hypot-v8.txt, written with node; plugins/solidcraft/tests/hypot.test.js
//! holds the file to the V8 the Deno tests run on).
use support_fins_solidcraft::hypot;

#[test]
fn hypot_is_v8s() {
    let text = include_str!("hypot-v8.txt");
    let bits = |h: &str| f64::from_bits(u64::from_str_radix(h, 16).expect("hex"));
    let mut n = 0;
    for line in text
        .lines()
        .filter(|l| !l.starts_with('#') && !l.is_empty())
    {
        let (args, want) = line.rsplit_once(' ').expect("args result");
        let args: Vec<f64> = if args.is_empty() {
            vec![]
        } else {
            args.split(',').map(bits).collect()
        };
        let (want, got) = (bits(want), hypot(&args));
        assert!(
            want.to_bits() == got.to_bits() || (want.is_nan() && got.is_nan()),
            "hypot({args:?}) = {got:e}, V8 {want:e}"
        );
        n += 1;
    }
    assert!(n > 600, "{n} cases");
}
