#!/usr/bin/env python3
"""
Run dist/support_fins.py against a stand-in `orca` module, outside Orca.

    <python3.12 with numpy + mini-racer + trimesh> plugin/orca/test_plugin.py a.stl b.stl ...

Use Orca's own interpreter for the venv (OrcaSlicer.app/.../python/bin/python3.12)
so the test sees the same CPython as the plugin. Each STL becomes one plate
object; the harness also mirrors the first one (checks the winding fix) and
flags any file opened during execute() other than the plugin's own output --
Orca's audit hook would prompt on or block those.
"""
import importlib.util
import os
import sys
import tempfile
import types
import zipfile

import numpy as np
import trimesh

HERE = os.path.dirname(os.path.abspath(__file__))


class _Result:
    def __init__(self, kind, message):
        self.kind, self.message = kind, message


def fake_orca(objects):
    class Mesh:
        def __init__(s, V, T): s.V, s.T = V, T
        def vertices(s): return s.V
        def triangles(s): return s.T

    class Vol:
        def __init__(s, V, T): s.m = Mesh(V, T)
        def mesh(s): return s.m
        def matrix(s): return np.eye(4)

    class Inst:
        def __init__(s, M): s.M = M
        def matrix(s): return s.M

    class Obj:
        def __init__(s, name, V, T, M): s.name, s.v, s.i = name, [Vol(V, T)], Inst(M)
        def volumes(s): return s.v
        def instance(s, i): return s.i

    base = type("Base", (), {})
    m = types.ModuleType("orca")
    m.ExecutionResult = types.SimpleNamespace(
        success=lambda message="", data="": _Result("success", message),
        skipped=lambda message="": _Result("skipped", message))
    m.script = types.SimpleNamespace(ScriptPluginCapabilityBase=base)
    m.base, m.plugin, m.register_capability = base, (lambda c: c), (lambda c: None)
    objs = [Obj(n, V, T, M) for n, V, T, M in objects]
    m.host = types.SimpleNamespace(model=lambda: types.SimpleNamespace(objects=lambda: objs))
    return m


def main(paths):
    objects = []
    for p in paths:
        mesh = trimesh.load(p, force="mesh")
        V = mesh.vertices.astype(np.float32)
        T = mesh.faces.astype(np.int32)
        objects.append((os.path.basename(p), V, T, np.eye(4)))
    # mirrored copy of the first part: must fin identically (up to the mirror)
    n, V, T, _ = objects[0]
    objects.append(("mirrored-" + n, V, T, np.diag([-1.0, 1, 1, 1])))

    sys.modules["orca"] = fake_orca(objects)
    spec = importlib.util.spec_from_file_location(
        "support_fins", os.path.join(HERE, "dist", "support_fins.py"))
    plugin = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(plugin)                    # "loading phase"
    assert plugin._ENGINE is not None, plugin._ENGINE_ERR

    out = tempfile.mkdtemp(prefix="sf-orca-")
    plugin.OUT_DIR = out
    opened = []
    sys.addaudithook(lambda ev, a: opened.append(a[0])
                     if ev == "open" and isinstance(a[0], str) else None)
    r = plugin.SupportFins().execute()                 # "executing phase"
    stray = [p for p in opened if not p.startswith(out)]

    print(f"\n[{r.kind}] {r.message}")
    for f in sorted(os.listdir(out)):
        with zipfile.ZipFile(os.path.join(out, f)) as z:
            names = z.namelist()
        m = trimesh.load(os.path.join(out, f), file_type="3mf", force="scene")
        geoms = list(m.geometry.values())
        print(f"  {f}: {names[-1]}, {len(geoms)} bodies, "
              f"{sum(len(g.faces) for g in geoms):,} faces, "
              f"bounds z {m.bounds[0][2]:.2f}..{m.bounds[1][2]:.2f}")
    print("  stray file opens during execute():", stray or "none")
    return 0 if r.kind == "success" and not stray else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
