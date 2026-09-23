# /// script
# requires-python = ">=3.12"
# dependencies = ["numpy", "trimesh"]
#
# [tool.orcaslicer.plugin]
# name = "Support Fins — Probe"
# description = "Reads the loaded model and reports its overhangs at 45 deg. A spike that proves the printfins.com auto-fit can run inside OrcaSlicer's plugin sandbox."
# author = "Matthew Trahan"
# version = "0.1.2"
# ///
"""
SPIKE / PROBE — does OrcaSlicer's plugin sandbox give us what printfins.com needs?

The website's whole trick is MESH ANALYSIS: read a model's triangles, find the
faces that overhang past 45 deg, and contour a breakaway fin to each one. Before
porting any of that (spike_overhangs.py + spike_fins.py, ~2k lines that lean on
trimesh) into an Orca plugin, this probe answers the two questions that decide
whether the port is even worth starting:

  1. GEOMETRY  Does `orca.host` actually hand back usable triangles for the model
               the user has loaded? The API is documented read-only -- `model()
               -> objects() -> volumes() -> mesh()` with `.vertices()`/`.triangles()`
               as numpy arrays -- but "documented" and "returns what we expect on a
               real STL/3MF the user dragged in" are different claims. This reads
               them and reports counts + bbox so we can eyeball it against the file.

  2. DEPS      The overhang math is pure-numpy-able. numpy is NOT bundled -- the
               host's vertices()/triangles()/matrix() raise ImportError without it,
               so it is declared in the PEP 723 `dependencies` above and Orca's
               bundled `uv` installs it at plugin-install time. trimesh is likewise
               not in the embedded interpreter, and the fuller fin steps
               (surface sampling, submesh, contact-line) currently use it. So the
               probe runs the OVERHANG CLASSIFICATION in pure numpy -- no trimesh --
               and separately just tries `import trimesh` to report whether the
               next phase can rely on it or must reimplement its handful of calls.

What the probe deliberately does NOT do: place anything on the plate. The Orca
host API is strictly read-only ("nothing here mutates the model") -- there is no
add-object / import-mesh / make-primitive call anywhere in the plugin surface.
That is the real ceiling and it is not a probe bug: fins can be COMPUTED here but
must be written to a .3mf and re-imported by the user. This probe stops at the
report so we can confirm the read + the math before building the export half.

Requires an OrcaSlicer NIGHTLY (or a release newer than 2.4.2) -- the plugin
system is not in 2.4.2 stable or earlier.

Install (side-load): OrcaSlicer -> Plugins -> Browse plugins (split button) ->
Install local plugin -> pick this .py. Manual alternative: it must sit in ITS OWN
subfolder, `<data_dir>/orca_plugins/support_fins_probe/support_fins_probe.py`
(a bare .py directly in orca_plugins/ is not picked up). Then run it
from the Plugins dialog's Run action with a model loaded on the plate; the report
comes back in the result dialog.

Constants are copied from prototype/spike_overhangs.py CONSTANT-FOR-CONSTANT so
the in-Orca numbers match the website and the Python probes on the same file. If
one changes, change it in both places.
"""
import math

import orca
import numpy as np

# Import trimesh HERE, at module load, not inside execute(). Orca's audit hook is
# inactive while plugins load but gates every file open during execute() -- and
# trimesh reads its own resources/*.json + dist-info METADATA at import time, so
# a lazy import inside execute() dies with PermissionError ([AUDIT BLOCKED] in
# the Orca log) even though the package is installed. Same rule for the port:
# any third-party package that reads its own data files gets imported up top.
try:
    import trimesh
    _TRIMESH_ERR = None
except Exception as e:  # ImportError, or a broken partial install
    trimesh = None
    _TRIMESH_ERR = e

OVERHANG_DEG = 45.0
OVERHANG_COS = math.cos(math.radians(OVERHANG_DEG))   # 0.70710678..., NOT 0.7071
# A face at EXACTLY the threshold is self-supporting; 45 deg is the canonical
# designed-in chamfer angle, so real parts carry thousands of faces on this exact
# boundary and the comparison must not decide them by float noise. See the long
# note in spike_overhangs.py: the old truncated 0.7071 pulled every 45 deg chamfer
# in (on one Voron part, a 2.1x overstatement of overhang area).
ANGLE_EPS = 1e-4                                      # ~0.008 deg of slack
OVERHANG_CUT = -(OVERHANG_COS + ANGLE_EPS)            # test: n_z < OVERHANG_CUT
MIN_REGION_AREA = 12.0        # mm^2; ignore slivers (a fin on a sliver is noise)
BED_EPS = 0.35                # mm; a face this close to the plate IS the bottom


def _probe_trimesh():
    """Report whether the fuller fin steps can lean on trimesh in this interpreter."""
    if trimesh is not None:
        return (f"[deps] trimesh {getattr(trimesh, '__version__', '?')} installed "
                "-- port can reuse the website's fin code")
    return (f"[deps] trimesh failed to import ({type(_TRIMESH_ERR).__name__}: "
            f"{_TRIMESH_ERR}) -- port must reimplement its calls in numpy")


def _world_mesh(obj, vol):
    """One volume's triangles in PLATE (world) space, winding-corrected.

    orca.host hands back vertices in the volume's LOCAL frame. The overhang test
    is a z-normal test, so it must run after the instance + volume transforms:
    a part the user rotated/scaled/lay-on-faced in Orca is otherwise scored in the
    orientation it had in the file, which is exactly the orientation they changed.
    """
    mesh = vol.mesh()
    V = np.asarray(mesh.vertices(), dtype=np.float64)
    T = np.asarray(mesh.triangles(), dtype=np.int64)
    M = np.asarray(obj.instance(0).matrix(), dtype=np.float64) @ \
        np.asarray(vol.matrix(), dtype=np.float64)
    V = (np.c_[V, np.ones(len(V))] @ M.T)[:, :3]
    # A mirrored transform (det < 0) flips the winding, which would flip every
    # normal and turn floors into "overhangs". Swap two indices to undo it.
    if np.linalg.det(M[:3, :3]) < 0:
        T = T[:, [0, 2, 1]]
    return V, T


def _is_model_part(vol):
    """Skip modifiers / negative volumes / support blockers if the API tells us.

    The host docs don't list a volume-type accessor, so probe a few likely names
    and default to "yes, it's a part" if none exist.
    """
    for attr in ("is_model_part",):
        f = getattr(vol, attr, None)
        if f is not None:
            try:
                return bool(f() if callable(f) else f)
            except Exception:
                pass
    return True


def _analyse_mesh(V, T, z0):
    """Pure-numpy overhang classification on one volume's triangle arrays.

    V: (N,3) float vertices in PLATE (world) coordinates.
    T: (M,3) int triangle vertex indices, winding already corrected.
    z0: the owning OBJECT's lowest z (all its part volumes), so a multi-volume
        object is seated as one part rather than each volume dropped separately.
    Mirrors spike_overhangs.py's nz-based test. Returns a dict of measures.

    Note: this scores the model in its CURRENT on-plate orientation only. The
    website's win is re-orienting to MINIMISE overhang before fitting fins; that is
    the next spike (spike_orient.py), not this one. Here we just prove read + math.
    """
    if V.size == 0 or T.size == 0:
        return None

    # Seat the part on the plate (min z -> 0), same as the website's print space.
    V = V - [0.0, 0.0, z0]

    tris = V[T]                       # (M,3,3): per-face vertex coords
    e1 = tris[:, 1] - tris[:, 0]
    e2 = tris[:, 2] - tris[:, 0]
    cross = np.cross(e1, e2)          # face normal * 2*area, winding-consistent
    areas = 0.5 * np.linalg.norm(cross, axis=1)
    norm = np.linalg.norm(cross, axis=1)
    nz = np.divide(cross[:, 2], norm, out=np.zeros_like(norm), where=norm > 1e-12)

    # A face is "bottom" (resting on the plate) if all three verts sit at z~=0;
    # those are support-free by definition and must not be flagged as overhang.
    tri_z = tris[:, :, 2]
    on_bed = (tri_z <= BED_EPS).all(axis=1)

    overhang = (nz < OVERHANG_CUT) & (~on_bed)
    over_area = float(areas[overhang].sum())
    total_area = float(areas.sum())

    return {
        "faces": int(T.shape[0]),
        "verts": int(V.shape[0]),
        "bbox": np.round(V.max(axis=0) - V.min(axis=0), 1).tolist(),
        "overhang_faces": int(overhang.sum()),
        "overhang_area": round(over_area, 1),
        "overhang_pct": round(100.0 * over_area / total_area, 1) if total_area else 0.0,
        "significant": over_area >= MIN_REGION_AREA,
    }


class SupportFinsProbe(orca.script.ScriptPluginCapabilityBase):
    def get_name(self):
        return "Support Fins — Probe overhangs"

    def execute(self):
        lines = []
        lines.append("Support Fins probe — reading loaded model via orca.host")
        lines.append(_probe_trimesh())
        lines.append("")

        try:
            model = orca.host.model()
        except Exception as e:
            # (failure() needs an orca.PluginResult enum as its status, whose
            # members aren't documented -- skipped() carries the message safely.)
            return orca.ExecutionResult.skipped(
                f"orca.host.model() raised {type(e).__name__}: {e}")

        objs = list(model.objects())
        if not objs:
            return orca.ExecutionResult.skipped(
                "No objects on the plate. Load a model, then run the probe.")

        any_overhang = False
        for oi, obj in enumerate(objs):
            vols = list(obj.volumes())
            lines.append(f"Object {oi}: {len(vols)} volume(s)")
            meshes = []
            for vi, vol in enumerate(vols):
                if not _is_model_part(vol):
                    lines.append(f"  vol {vi}: modifier/negative -- skipped")
                    continue
                try:
                    meshes.append((vi, *_world_mesh(obj, vol)))
                except Exception as e:
                    lines.append(f"  vol {vi}: mesh read FAILED "
                                 f"({type(e).__name__}: {e})")
            if not meshes:
                continue
            z0 = min((V[:, 2].min() for _, V, _ in meshes if V.size), default=0.0)
            for vi, V, T in meshes:
                r = _analyse_mesh(V, T, z0)
                if r is None:
                    lines.append(f"  vol {vi}: empty mesh")
                    continue
                any_overhang = any_overhang or r["significant"]
                flag = "NEEDS FINS" if r["significant"] else "clean (as-oriented)"
                lines.append(
                    f"  vol {vi}: {r['faces']:,} faces, bbox {r['bbox']} mm -> "
                    f"{r['overhang_faces']:,} overhang faces, "
                    f"{r['overhang_area']} mm^2 ({r['overhang_pct']}%) -> {flag}")

        lines.append("")
        lines.append("Read + overhang math ran inside Orca — the printfins.com "
                     "analysis half is portable.")
        lines.append("NOTE: placing fins on the plate is NOT possible via the Orca "
                     "plugin API (host is read-only). Next phase writes a finned "
                     ".3mf for File > Import.")

        msg = "\n".join(lines)
        # Surface the report in the result dialog AND stdout (Orca log) so it's
        # readable even if the dialog truncates a long multi-object report.
        print(msg)
        return orca.ExecutionResult.success(msg)


@orca.plugin
class SupportFinsPlugin(orca.base):
    def register_capabilities(self):
        orca.register_capability(SupportFinsProbe)
