"""Support Fins -- shared Python host for the plugins that run the engine in V8.

Every Python plugin that runs the website's engine in mini-racer (Orca today; Cura
and FreeCAD next) starts V8 and moves triangles across the same way, so that code
lives here once instead of in each plugin. Nothing here knows about fins: the
geometry is the bundle's (plugins/shared/bundle.py), and a plugin's own code only
reads the host's mesh and adds the result back.

    ctx = host_engine(ENGINE_JS)                  # once per process
    fins, stats = host_compute(ctx, soup, {"layerHeight": 0.2, "coverage": 0.5})
    options = host_options(ctx, dialog_values)    # a settings dialog's values (options.json)

How each plugin gets this file:
  Orca     inlined into the single-file plugin by plugins/orca/build.py
  others   copied next to the plugin by its build and imported

Needs numpy and mini-racer (py_mini_racer) in the host's Python.
"""
import atexit
import base64
import json
import os
import sys

_host_ctx = None


def host_engine(js_source, vendor_dir=None):
    """The one V8 context for this process, with the engine bundle loaded.

    js_source   the bundle's text (global SupportFinsEngine)
    vendor_dir  folder holding a vendored py_mini_racer/ package, for hosts that can't
                pip-install it (Cura). Under a PyInstaller app mini-racer looks for its
                library in sys._MEIPASS, the app's own bundle, and importlib.resources
                can't open files from a plugin folder there either (both seen in Cura
                5.13). Pointing _MEIPASS at vendor_dir while V8 starts fixes both.

    On macOS V8 runs --jitless: mini-racer's JIT hits SIGTRAP there, and a hardened
    app may refuse JIT memory anyway (lessons from the first Orca spike).
    """
    global _host_ctx
    if _host_ctx is None:
        from py_mini_racer import MiniRacer, init_mini_racer
        flags = ["--single-threaded"]
        if sys.platform == "darwin":
            flags.append("--jitless")
        missing = object()
        saved = getattr(sys, "_MEIPASS", missing)
        if vendor_dir is not None:
            sys._MEIPASS = os.fspath(vendor_dir)
        try:
            init_mini_racer(flags=flags, ignore_duplicate_init=True)
        finally:
            if vendor_dir is not None:
                if saved is missing:
                    del sys._MEIPASS
                else:
                    sys._MEIPASS = saved
        ctx = MiniRacer()
        ctx.eval(js_source)
        # mini-racer never tears V8 down by itself: without an explicit close(), the
        # interpreter hangs forever at exit (seen in pytest on macOS, any V8 flags).
        atexit.register(ctx.close)
        _host_ctx = ctx
    return _host_ctx


def host_compute(ctx, soup, options):
    """Run the engine on a posed part.

    soup     (M,3,3) triangles, mm, z up, in whatever frame the caller likes. Kept
             float64 on the way in: rounding to float32 can flip a borderline tine
             (plugins/shared/ENGINE-SENSITIVITY.md).
    options  engine options by their engine names (layerHeight, coverage, ...);
             anything left out takes the engine's default (fins_entry.js).
    Returns (fins (K,3,3) float64 in the SAME frame as `soup`, stats dict).
    """
    import numpy as np  # here, not at the top: Orca reports a failed numpy install itself
    soup = np.ascontiguousarray(soup, dtype=np.float64)
    raw = ctx.call(
        "SupportFinsEngine.computeFinsB64",
        base64.b64encode(soup.tobytes()).decode("ascii"),
        json.dumps(options),
    )
    out = json.loads(raw)
    seated = np.frombuffer(base64.b64decode(out["triangles"]), dtype=np.float32)
    seated = seated.astype(np.float64).reshape(-1, 3, 3)
    off = out["offset"]  # seated = input + offset
    fins = seated - np.array([off["x"], off["y"], off["z"]], dtype=np.float64)
    return fins, out["stats"]


def host_schema(ctx):
    """options.json, the settings a plugin dialog is built from (as bundled)."""
    return json.loads(ctx.call("SupportFinsEngine.optionsSchemaJson"))


def host_options(ctx, values):
    """A dialog's {options.json key: value} -> engine options for host_compute.

    Always go through this rather than building the options by hand: it nests the
    sway keys, checks every value and refuses a bad one (a percent control sends
    value / 100; None or '' means the default). Raises on a bad value.
    """
    try:
        return json.loads(ctx.call("SupportFinsEngine.optionsFromDialogJson", json.dumps(values)))
    except Exception as e:
        raise ValueError(_js_message(e)) from None


def _js_message(e):
    """V8's error text carries the whole bundle's source after the message; keep only
    what the engine said ("coverage must be 0..1 ..."), which is what a user sees."""
    text = str(e)
    at = text.find("Error: ")
    return text[at + 7:].split("\n", 1)[0] if at >= 0 else text.split("\n", 1)[0]


def host_visible(ctx, key, values):
    """Whether the dialog shows the control for `key` given the current values."""
    return bool(ctx.call("SupportFinsEngine.optionVisibleJson", key, json.dumps(values)))


def host_report(stats):
    """The one-line result every plugin shows, from the engine's stats.

    Says what was placed, and -- quality first -- what wasn't: overhangs too shallow
    for a fin this way up, and pieces that start in mid-air. Same facts as the
    website's readout (web/ui/readout.js), shorter.
    """
    walls = stats.get("braces", 0) + stats.get("props", 0)   # tined + plain, as the site counts
    tines = stats.get("tines", 0)
    parts = [f"{walls} wall{'' if walls == 1 else 's'}, {tines} tine{'' if tines == 1 else 's'}"]
    unserved = stats.get("unserved") or 0
    if unserved:
        parts.append(f"{unserved} overhang{' is' if unserved == 1 else 's are'} too shallow "
                     "for a fin this way up (tilt the part steeper)")
    floating = stats.get("floating") or 0
    if floating:
        drop = float(stats.get("floatingDrop") or 0)
        parts.append((f"one piece isn't joined to the rest: it starts {drop:.1f} mm up"
                      if floating == 1 else
                      f"{floating} pieces aren't joined to the rest: the first starts {drop:.1f} mm up")
                     + ", held only by supports")
    return "; ".join(parts)
