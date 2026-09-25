# Support Fins — shared plugin code

Code every plugin that can run JavaScript shares, so they all run **the website's
engine (`web/*.js`), unmodified**, instead of keeping their own copy of the geometry.
A fix on the site reaches a plugin the next time it is built.

```
engine/fins_entry.js    posed triangle soup in (mm, z up) -> fin + bed-pad triangles out
engine/bridge.js        base64 in/out for Python hosts running the bundle in V8 (mini-racer)
bundle.py               esbuild: bridge.js + web/*.js -> one IIFE, global SupportFinsEngine
tests/                  Deno tests: same fins as the website, anywhere on the plate;
                        the base64 bridge round-trips exactly
ENGINE-SENSITIVITY.md   engine note: tine placement moves under 1e-13 mm of noise, and
                        how fins_entry.js neutralises it
```

```
python3 plugins/shared/bundle.py out.js     # needs esbuild (npx fetches it on demand)
deno test --allow-read plugins/shared/tests/
```

Used by: [Orca](../orca/README.md) (inlines the bundle into its single-file plugin).
Onshape (FeatureScript) and Prusa (Lua) can't run JavaScript, so they don't use this.

CI: [`.github/workflows/plugins.yml`](../../.github/workflows/plugins.yml) rebuilds and tests
the plugins on every PR and push that touches `web/` or `plugins/`, and on main publishes
the builds to the [`plugins-latest`](https://github.com/gittrahan/support-fins/releases/tag/plugins-latest)
pre-release.
