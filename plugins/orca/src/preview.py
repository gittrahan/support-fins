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
    """config_value() over an object and the presets, for _nozzle."""
    def __init__(self, obj, bundle):
        self.obj, self.bundle = obj, bundle

    def config_value(self, key):
        return _setting(self.obj, self.bundle, key)


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


def snapshot(model, bundle, index, cfg):
    """Everything a preview build needs, read on the UI thread (the model can change under a
    worker): the posed soup, its settings, and whether the slice would fin it at all."""
    objs = model.objects()
    if not 0 <= index < len(objs):
        raise ValueError("that part is no longer on the plate: refresh the list")
    obj = objs[index]
    try:
        lh = float(_setting(obj, bundle, "layer_height") or 0.2)
    except (TypeError, ValueError):
        lh = 0.2
    supports = _truthy(_setting(obj, bundle, "enable_support") or "0")
    return {"id": index, "name": obj.name or f"Object {index + 1}", "soup": object_soup(obj),
            "layer_height": lh, "nozzle": _nozzle(_Values(obj, bundle)), "cfg": cfg,
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
           "skipped": job["skipped"], "faces": int(len(soup)), "size": (hi - lo).round(1).tolist(),
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


class SupportFinsPreview(orca.script.ScriptPluginCapabilityBase):
    """Plugins > Support Fins > Preview fins: opens the panel, then builds previews on this
    Script's worker until the panel closes."""
    panel = None
    _queue = None
    _loop = None

    def get_name(self):
        return "Preview fins"

    async def execute(self):
        if self.panel is not None and self.panel.is_open():
            self.panel.show()
            return orca.ExecutionResult.success("The Support Fins preview is already open.")
        if PREVIEW_PAGE.startswith("__SF_PREVIEW"):
            return orca.ExecutionResult.failure(orca.PluginResult.RecoverableError,
                                                "preview page missing -- run plugins/orca/build.py")
        self._loop = asyncio.get_running_loop()
        self._queue = asyncio.Queue()
        self.panel = orca.host.ui.create_dock_panel(html=PREVIEW_PAGE, title="Support Fins preview",
                                                    width=380, height=560, on_message=self.on_message,
                                                    on_close=self.on_close, dock="right")
        try:
            while True:
                job = await self._queue.get()
                if job is None:
                    break
                await self.work(job)
        finally:
            self._queue = self._loop = None
        return orca.ExecutionResult.success("Support Fins preview closed.")

    async def work(self, job):
        # the newest request wins: a part picked twice in a row is built once
        while not self._queue.empty():
            nxt = self._queue.get_nowait()
            if nxt is None:
                self._queue.put_nowait(None)
                break
            job = nxt
        try:
            msg = preview(job)
        except Exception as e:   # the panel says why; Orca stays up
            why = str(e) if isinstance(e, ValueError) else f"{type(e).__name__}: {e}"
            msg = {"command": "error", "id": job["id"], "error": why}
        if self.panel is not None:
            self.panel.post(msg)

    # Orca's UI thread: quick reads only, then hand the build to the worker.
    def on_message(self, message):
        command = (message or {}).get("command")
        try:
            if command in ("ready", "refresh"):
                self.panel.post(plate_parts(orca.host.model()))
            elif command == "preview":
                cfg = _cfg(_SLICING[0]) if _SLICING else dict(_DEFAULTS)
                job = snapshot(orca.host.model(), orca.host.preset_bundle(), int(message.get("id", -1)), cfg)
                self.panel.post({"command": "busy", "id": job["id"]})
                self._loop.call_soon_threadsafe(self._queue.put_nowait, job)
        except Exception as e:
            why = str(e) if isinstance(e, ValueError) else f"{type(e).__name__}: {e}"
            self.panel.post({"command": "error", "id": (message or {}).get("id"), "error": why})

    def on_close(self):
        self.panel = None
        if self._loop is not None:
            self._loop.call_soon_threadsafe(self._queue.put_nowait, None)
