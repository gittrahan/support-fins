Clipper JavaScript 6.4.2.2, npm `clipper-lib@6.4.2`.

Source: https://registry.npmjs.org/clipper-lib/-/clipper-lib-6.4.2.tgz

Tarball SHA-512 (base64):
`knglhjQX5ihNj/XCIs6zCHrTemdvHY3LPZP9XB2nq2/3igyYMFueFXtfp84baJvEE+f8pO1ZS4UVeEgmLnAprQ==`

Upstream clipper.js SHA-256: `a650c6946682edc1a64016f6553eeb5c32ce45eb7ca0ad5d8221961af011d97c`.

Trailing whitespace is normalized; the source is otherwise unchanged between
the ESM isolation prefix and export suffix.
The prefix selects the synchronous CommonJS implementation and keeps its legacy
globals private. The suffix makes errors throw rather than call alert.
No network, DOM, WASM initialization or host modules are needed at runtime.

Boost licence and the embedded JSBN notice are retained alongside this file.
JSBN notice source: npm jsbn@1.1.0 package/LICENSE (upstream Stanford URL is
currently unavailable). Preserve both notices when redistributing bundles.
Both are also included in an `@license` comment retained by the plugin bundler.

Reproduce the wrapper with `python3 prototype/vendor-clipper.py
tmp/clipper-lib-6.4.2.tgz` after saving the pinned tarball inside the checkout.
The script verifies SHA-512 and does not install dependencies or use a cache.
