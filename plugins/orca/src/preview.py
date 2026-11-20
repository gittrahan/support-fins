# The fin preview panel (#477): pick a part on the plate and see, before slicing, its
# overhangs (red), the small-hole ceilings left to bridge (amber) and the fins the slice
# will add (green), with the same result line and tilt hint the slice notification gives.
#
# Orca 2.5 gives plugins an HTML dock panel (orca.host.ui.create_dock_panel) opened from a
# Script capability. The panel's messages arrive on Orca's UI thread, so the plugin reads
# the part there (a quick copy of its mesh and settings) and hands the fin build to the
# Script's own worker thread through an asyncio queue, as Orca's plugin docs lay out, so
# Orca never freezes while fins are built. build.py inlines this file into
# support_fins_orca.py; it uses that file's engine glue (engine_options, host_*, _cfg...).
# (asyncio, base64, threading, time, np: imported at the top of support_fins_orca.py)
PREVIEW_PAGE = "__SF_PREVIEW_PAGE__"   # replaced by build.py: src/preview_page.html + .js
PREVIEW_DRAW_MAX = 250_000   # part triangles drawn in the panel; over this only overhangs are
_ENGINE_LOCK = threading.RLock()   # the slice and the panel share one V8 context
_SLICING = []   # the Support Fins slicing capability once Orca has made it: its config


def _b64(a, dtype):
    return base64.b64encode(np.ascontiguousarray(a, dtype=dtype).tobytes()).decode("ascii")


def _setting(obj, bundle, key):
    """An object's own setting, else the selected presets' (Orca's object list overrides)."""
    for get in (lambda: obj.config_value(key), lambda: bundle.full_config_value(key)):
        try:
            v = get()
        except Exception:
            v = None
        if v not in (None, ""):
            return v
    return None


class _Values:
    """config_value() over an object and the presets, each key read once (the preset
    bundle rebuilds its full config on every lookup)."""
    def __init__(self, obj, bundle):
        self.obj, self.bundle, self._seen = obj, bundle, {}

    def config_value(self, key):
        if key not in self._seen:
            self._seen[key] = _setting(self.obj, self.bundle, key)
        return self._seen[key]


def object_soup(obj):
    """The object as it sits on the plate (first instance), model parts only, as
    posed_part_soup gives the slice: (M,3,3) float64, plate frame (+X right, +Y back)."""
    inst = obj.instances()[0] if obj.instance_count() else None
    I = np.asarray(inst.matrix(), dtype=np.float64) if inst is not None else np.eye(4)
    chunks = []
    for vol in obj.volumes():
        if not vol.is_model_part():
            continue
        mesh = vol.mesh()
        V = np.asarray(mesh.vertices(), dtype=np.float64)
        T = np.asarray(mesh.triangles(), dtype=np.int64)
        if len(T) == 0:
            continue
        M = I @ np.asarray(vol.matrix(), dtype=np.float64)
        tris = (V @ M[:3, :3].T + M[:3, 3])[T]
        if np.linalg.det(M[:3, :3]) < 0:
            tris = tris[:, [0, 2, 1], :]
        chunks.append(tris)
    return np.concatenate(chunks, axis=0) if chunks else np.empty((0, 3, 3))


def plate_parts(model):
    """The panel's part list."""
    out = []
    for i, obj in enumerate(model.objects()):
        out.append({"id": i, "name": obj.name or f"Object {i + 1}", "faces": int(obj.facets_count())})
    return {"command": "parts", "parts": out}


def snapshot(model, bundle, index, cfg, cfg_note=""):
    """Everything a preview build needs, read on the UI thread (the model can change under a
    worker): the posed soup, its settings, and whether the slice would fin it at all."""
    objs = model.objects()
    if not 0 <= index < len(objs):
        raise ValueError("that part is no longer on the plate: refresh the list")
    obj = objs[index]
    values = _Values(obj, bundle)
    try:
        lh = float(values.config_value("layer_height") or 0.2)
    except (TypeError, ValueError):
        lh = 0.2
    supports = _truthy(values.config_value("enable_support") or "0")
    soup = object_soup(obj)
    if len(soup):   # bottom on the plate, as inject_fins seats the part for the engine
        soup[..., 2] -= soup[..., 2].min()
    return {"id": index, "name": obj.name or f"Object {index + 1}", "soup": soup,
            "layer_height": lh, "nozzle": _nozzle(values), "cfg": cfg, "cfg_note": cfg_note,
            "skipped": (not _truthy(cfg["enabled"]) and "Support Fins is turned off in its settings")
                       or (supports and cfg["apply_to"] != "all"
                           and "Orca supports are on for this part, so the slice leaves it to them")
                       or ""}


def preview(job):
    """Build the fins for one snapshot: the panel's 'result' message."""
    soup = job["soup"]
    if len(soup) == 0:
        return {"command": "error", "id": job["id"], "error": "this part has no solid to fin"}
    t0 = time.time()
    lo = soup.reshape(-1, 3).min(axis=0)
    hi = soup.reshape(-1, 3).max(axis=0)
    centre = np.array([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2]])
    with _ENGINE_LOCK:
        ctx = _engine_ctx()
        opts = engine_options(ctx, job["cfg"], job["layer_height"], job["nozzle"])
        fins, stats, _pieces, over, small = host_compute_pieces(ctx, soup, opts)
        log = {}
        report = host_report(stats) + tilt_hint(soup, job["layer_height"], job["cfg"], job["nozzle"], stats, log)
    cls = np.zeros(len(soup), dtype=np.uint8)
    cls[over] = 1
    cls[small] = 2
    msg = {"command": "result", "id": job["id"], "name": job["name"], "report": report,
           "skipped": job["skipped"], "cfg_note": job.get("cfg_note", ""), "faces": int(len(soup)), "size": (hi - lo).round(1).tolist(),
           "seconds": round(time.time() - t0, 2), "fins": _b64((fins - centre).reshape(-1), "<f4")}
    if len(soup) <= PREVIEW_DRAW_MAX:
        msg["part"] = _b64((soup - centre).reshape(-1), "<f4")
        msg["cls"] = _b64(cls, "u1")
    else:   # too many to draw: the faces that matter, and say so
        keep = cls > 0
        msg["part"] = _b64((soup[keep] - centre).reshape(-1), "<f4")
        msg["cls"] = _b64(cls[keep], "u1")
        msg["partial"] = True
    return msg


class _Session:
    """One open panel and the Script run serving it. Kept apart from the capability, which
    Orca keeps for the plugin's life: a panel closed mid-build and opened again gets a new
    session, and the old run's late result or clean-up can't reach the new one."""

    def __init__(self, loop):
        self.loop, self.queue, self.panel, self.closed = loop, asyncio.Queue(), None, False

    def post(self, msg):
        panel = self.panel
        if panel is not None and not self.closed:
            panel.post(msg)

    def submit(self, job):
        """From the UI thread: hand a job (None = stop) to the run's loop. False when the
        run has already ended."""
        try:
            self.loop.call_soon_threadsafe(self.queue.put_nowait, job)
            return True
        except RuntimeError:   # loop closed
            return False


class SupportFinsPreview(orca.script.ScriptPluginCapabilityBase):
    """Plugins > Support Fins > Preview fins: opens the panel, then builds previews on this
    Script's worker until the panel closes."""
    session = None

    def get_name(self):
        return "Preview fins"

    async def execute(self):
        s = self.session
        if s is not None and not s.closed and s.panel is not None and s.panel.is_open():
            s.panel.show()
            return orca.ExecutionResult.success("The Support Fins preview is already open.")
        if PREVIEW_PAGE.startswith("__SF_PREVIEW"):
            return orca.ExecutionResult.failure(orca.PluginResult.RecoverableError,
                                                "preview page missing -- run plugins/orca/build.py")
        s = self.session = _Session(asyncio.get_running_loop())
        s.panel = orca.host.ui.create_dock_panel(html=PREVIEW_PAGE, title="Support Fins preview",
                                                 width=380, height=560,
                                                 on_message=lambda m: self.on_message(s, m),
                                                 on_close=lambda: self.on_close(s), dock="right")
        try:
            while True:
                job = await s.queue.get()
                if job is None:
                    break
                self.work(s, job)
        finally:
            # stopped with the panel still up (Orca cancelled the run: plugin reloaded or
            # turned off): say so rather than leave the page waiting
            s.post({"command": "stopped",
                    "error": "the preview stopped (plugin reloaded?): close the panel and open it again"})
            s.closed = True
            if self.session is s:
                self.session = None
        return orca.ExecutionResult.success("Support Fins preview closed.")

    @staticmethod
    def work(s, job):
        # the newest request wins: a part picked twice in a row is built once
        while not s.queue.empty():
            nxt = s.queue.get_nowait()
            if nxt is None:
                s.queue.put_nowait(None)
                break
            job = nxt
        try:
            msg = preview(job)
        except Exception as e:   # the panel says why; Orca stays up
            why = str(e) if isinstance(e, ValueError) else f"{type(e).__name__}: {e}"
            msg = {"command": "error", "id": job["id"], "error": why}
        s.post(msg)

    # Orca's UI thread: quick reads only, then hand the build to the worker.
    @staticmethod
    def on_message(s, message):
        if s.closed or s.panel is None:
            return
        command = (message or {}).get("command")
        try:
            if command in ("ready", "refresh"):
                s.post(plate_parts(orca.host.model()))
            elif command == "preview":
                if _SLICING:
                    cfg, note = _cfg(_SLICING[0]), ""
                else:
                    cfg, note = dict(_DEFAULTS), "Support Fins' settings weren't loaded yet: previewed with the defaults"
                job = snapshot(orca.host.model(), orca.host.preset_bundle(), int(message.get("id", -1)), cfg, note)
                s.post({"command": "busy", "id": job["id"]})
                if not s.submit(job):
                    s.post({"command": "stopped", "error": "the preview stopped: close the panel and open it again"})
        except Exception as e:
            why = str(e) if isinstance(e, ValueError) else f"{type(e).__name__}: {e}"
            try:
                s.post({"command": "error", "id": (message or {}).get("id"), "error": why})
            except Exception:
                pass

    @staticmethod
    def on_close(s):
        s.closed = True
        s.submit(None)
