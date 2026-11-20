"""An in-memory fin cache: a re-slice that leaves a part's fins unchanged skips the build.

Orca re-runs Step.posSlice -- where this plugin builds fins -- for many changes that
do not touch the fins: a slicing setting such as xy compensation or slice closing
radius, a re-slice after a cancel, a modifier added to the object, and the same part
added again as another object. The fins depend only on the part's shape and
orientation (not where it stands on the plate), the engine options, the layer height
and the nozzle, so the same inputs give the same fins.

KEY    hash of the part triangles with the footprint's min corner subtracted (a part
       moved in X, Y or Z hits; one turned about Z misses, since fins depend on the
       X/Y orientation) + the exact engine options (which carry layerHeight and
       nozzle) + the plugin version.
VALUE  the fins in that corner-origin frame, the engine's stats, the report line and
       the tilt-hint pieces. The caller adds the corner back, on a miss as on a hit.
       The engine runs on the corner-origin part either way, so a part left where it
       was gets byte-identical fins, and a moved part's differ from a fresh build by
       float noise (~1e-15 mm) only.
Bounded LRU, in memory only, safe for objects sliced in parallel.
"""
import copy
import hashlib
import json
import threading
from collections import OrderedDict

# numpy is imported where it is used: Orca reports a failed numpy install itself

# Part triangles are rounded to this (mm) for the KEY only, so moving a part (whose
# vertices then differ by float noise ~1e-13) is the same key. The engine gets the
# unrounded part: it is sensitive enough that rounding to 1e-5 mm moved a tine 0.2 mm.
FIN_CACHE_ROUND_MM = 1e-5
FIN_CACHE_ENTRIES = 8
FIN_CACHE_MAX_TRIANGLES = 1_000_000   # fin triangles held across all entries (~72 MB)


def normalize_soup(soup):
    """(M,3,3) float64 -> (soup relative to its X/Y min corner; the corner as (3,) with z 0).
    The caller has already put the part's bottom at z = 0."""
    import numpy as np
    origin = np.array([soup[:, :, 0].min(), soup[:, :, 1].min(), 0.0])
    return np.ascontiguousarray(soup - origin), origin


def fin_cache_key(norm_soup, options, version):
    import numpy as np
    h = hashlib.blake2b(digest_size=20)
    h.update(str(norm_soup.shape).encode())
    h.update(np.round(norm_soup / FIN_CACHE_ROUND_MM).astype(np.int64).tobytes())
    h.update(json.dumps(options, sort_keys=True, default=str).encode())
    h.update(str(version).encode())
    return h.hexdigest()


class FinCache:
    def __init__(self, entries=FIN_CACHE_ENTRIES, max_triangles=FIN_CACHE_MAX_TRIANGLES):
        self.entries = entries
        self.max_triangles = max_triangles
        self._d = OrderedDict()   # key -> (value dict, fin triangle count)
        self._lock = threading.Lock()
        self.hits = 0
        self.misses = 0

    def get(self, key):
        with self._lock:
            item = self._d.get(key)
            if item is None:
                self.misses += 1
                return None
            self._d.move_to_end(key)
            self.hits += 1
            value = item[0]
        return {**value, "fins": value["fins"], "stats": copy.deepcopy(value["stats"]),
                "extra": copy.deepcopy(value["extra"])}

    def put(self, key, value):
        """False when the entry is too big to keep (nothing is evicted for it)."""
        n = len(value["fins"])
        if n > self.max_triangles:
            return False
        value["fins"].setflags(write=False)
        with self._lock:
            self._d.pop(key, None)
            self._d[key] = (value, n)
            total = sum(c for _, c in self._d.values())
            while self._d and (len(self._d) > self.entries or total > self.max_triangles):
                _, (_, c) = self._d.popitem(last=False)
                total -= c
        return True

    def clear(self):
        with self._lock:
            self._d.clear()
            self.hits = self.misses = 0

    def __len__(self):
        return len(self._d)
