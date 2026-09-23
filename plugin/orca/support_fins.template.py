# /// script
# requires-python = ">=3.12"
# dependencies = ["numpy", "mini-racer"]
#
# [tool.orcaslicer.plugin]
# name = "Support Fins"
# description = "Fits printfins.com breakaway support fins to every part on the plate and saves each finned part as a .3mf to import back in."
# author = "Matthew Trahan"
# version = "@@VERSION@@"
# ///
"""
Support Fins for OrcaSlicer -- the printfins.com engine, run on your plate.

GENERATED FILE. Edit support_fins.template.py / engine_glue.js and re-run
build.py; the engine source below is bundled from web/ at @@ENGINE_REV@@.

How it works
------------
The fin engine is the website's own JavaScript (overhangs.js, fins.js, prop.js,
planes.js, inside.js, threemf.js), bundled into ENGINE_JS below and run in an
embedded V8 (mini-racer). No Python port: the plugin fins a part exactly the way
printfins.com's Auto mode does, and can't drift from it.

Orca's plugin API is read-only -- it can hand us the meshes on the plate but has
no call to add geometry. So each finned part is written as a .3mf (the same file
the site's "Export 3MF" makes: part + fins as one object) for File > Import.

Three sandbox rules shape the code:
  * mini-racer is imported and V8 started at MODULE LOAD. Orca audits every file
    open during execute(), and starting V8 reads its ICU data file -- a lazy start
    inside execute() is blocked (same trap trimesh hit in the probe).
  * V8 runs --jitless. Its JIT crashes (SIGTRAP) under mini-racer on macOS, and a
    hardened app like Orca may not grant JIT memory anyway. The interpreter is
    ~15x slower but still ~0.1-0.3s for a typical part, ~2s for a 44k-face one.
  * Writing to ~/Downloads is outside Orca's allowed roots, so Orca asks Yes/No
    per new file. On No we fall back to Orca's own data folder (always allowed).
"""
import json
import os
import base64

import orca
import numpy as np

import py_mini_racer._dll as _mr_dll
from py_mini_racer import MiniRacer

ENGINE_JS = @@ENGINE_JS@@

# The website's defaults (index.html): Auto mode, bed pad on, tines on at the
# default density, 0.2mm layers, 50% coverage.
FIN_OPTS = {"mode": "auto", "bedPad": True, "tines": True, "tineDensity": 0.0,
            "layerHeight": 0.2, "coverage": 0.5}

OUT_DIR = os.path.expanduser("~/Downloads/support-fins")

try:
    _mr_dll.init_mini_racer(flags=("--single-threaded", "--jitless"),
                            ignore_duplicate_init=True)
    _ENGINE = MiniRacer()
    _ENGINE.eval(ENGINE_JS)
    _ENGINE_ERR = None
except Exception as e:  # keep the plugin loadable so the dialog can say why
    _ENGINE = None
    _ENGINE_ERR = e


def _world_tris(obj, vol):
    """One volume's triangles in PLATE space as an (M,3,3) array.

    orca.host gives volume-LOCAL vertices; the engine must see the part the way
    the user posed it on the plate, so apply instance @ volume. A mirrored
    transform (det < 0) flips the winding -- swap two corners to keep normals out.
    """
    mesh = vol.mesh()
    V = np.asarray(mesh.vertices(), dtype=np.float64)
    T = np.asarray(mesh.triangles(), dtype=np.int64)
    M = np.asarray(obj.instance(0).matrix(), dtype=np.float64) @ \
        np.asarray(vol.matrix(), dtype=np.float64)
    V = (np.c_[V, np.ones(len(V))] @ M.T)[:, :3]
    if np.linalg.det(M[:3, :3]) < 0:
        T = T[:, [0, 2, 1]]
    return V[T]


def _is_model_part(vol):
    """Skip modifiers / negative volumes when the API exposes it; the host docs
    don't list a volume-type accessor, so default to treating it as a part."""
    f = getattr(vol, "is_model_part", None)
    if f is None:
        return True
    try:
        return bool(f() if callable(f) else f)
    except Exception:
        return True


def _object_name(obj, i):
    name = getattr(obj, "name", None)
    name = name() if callable(name) else name
    name = str(name or f"object-{i + 1}")
    stem = os.path.splitext(os.path.basename(name))[0]
    return "".join(c if c.isalnum() or c in "-_ ." else "_" for c in stem) or f"object-{i + 1}"


def _save(fname, data):
    """Write to ~/Downloads/support-fins; if Orca's permission prompt is refused,
    fall back to Orca's data folder, which plugins may always write."""
    for d in (OUT_DIR, os.path.join(_data_dir(), "support-fins")):
        try:
            os.makedirs(d, exist_ok=True)
            path = os.path.join(d, fname)
            with open(path, "wb") as f:
                f.write(data)
            return path
        except PermissionError:
            continue
    raise PermissionError("no writable folder (Downloads refused, data folder refused)")


def _data_dir():
    for name in ("data_dir",):
        f = getattr(orca, name, None) or getattr(orca.host, name, None)
        if callable(f):
            try:
                return str(f())
            except Exception:
                pass
    return os.path.expanduser("~/Library/Application Support/OrcaSlicer")


class SupportFins(orca.script.ScriptPluginCapabilityBase):
    def get_name(self):
        return "Support Fins — fit fins to the plate"

    def execute(self):
        if _ENGINE is None:
            return orca.ExecutionResult.skipped(
                f"Support Fins engine failed to start ({type(_ENGINE_ERR).__name__}: "
                f"{_ENGINE_ERR}). Try reinstalling the plugin.")
        try:
            objs = list(orca.host.model().objects())
        except Exception as e:
            return orca.ExecutionResult.skipped(f"Couldn't read the plate ({e}).")
        if not objs:
            return orca.ExecutionResult.skipped("Nothing on the plate. Add a part, then run Support Fins.")

        saved, clean, failed, report = [], [], [], []
        for i, obj in enumerate(objs):
            name = _object_name(obj, i)
            try:
                parts = [_world_tris(obj, v) for v in obj.volumes() if _is_model_part(v)]
                tris = np.concatenate(parts) if parts else np.zeros((0, 3, 3))
                if not len(tris):
                    continue
                r = json.loads(_ENGINE.call(
                    "sfFinPart", tris.astype(np.float32).ravel().tolist(), name, FIN_OPTS,
                    timeout_sec=120))
            except Exception as e:
                failed.append(name)
                report.append(f"{name}: FAILED {type(e).__name__}: {e}")
                continue

            if not r["threemf"]:
                clean.append(name)
                report.append(f"{name}: no fins needed ({r['regions']} overhang regions, "
                              f"{r['unserved']} unserved)")
                continue
            try:
                path = _save(f"{name}-fins.3mf", base64.b64decode(r["threemf"]))
            except Exception as e:
                failed.append(name)
                report.append(f"{name}: fins built but not saved ({e})")
                continue
            saved.append(path)
            extras = (", bed pad" if r["pad"] else "") + \
                     (f", {r['unserved']} regions unserved" if r["unserved"] else "")
            report.append(f"{name}: {r['fins']} fins, {r['tines']} tines{extras} -> {path}")

        print("Support Fins\n  " + "\n  ".join(report))  # full detail -> Orca log

        # Orca's result dialog flattens newlines, so keep the message to a sentence
        # or two; the per-part detail goes to the log above.
        if not saved:
            msg = "No fins needed" if not failed else f"Couldn't fin {', '.join(failed)}"
            if clean:
                msg += f" ({', '.join(clean)} {'is' if len(clean) == 1 else 'are'} already printable as posed)"
            return orca.ExecutionResult.success(msg + ".")
        where = os.path.dirname(saved[0])
        msg = (f"Fins fitted to {len(saved)} of {len(saved) + len(clean) + len(failed)} parts, "
               f"saved to {where}. File > Import the .3mf, then delete the original part.")
        if failed:
            msg += f" Failed: {', '.join(failed)}."
        return orca.ExecutionResult.success(msg)


@orca.plugin
class SupportFinsPlugin(orca.base):
    def register_capabilities(self):
        orca.register_capability(SupportFins)
