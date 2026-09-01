#!/usr/bin/env python3
"""
Dev server for Support Fins -- serves web/ with caching turned OFF.

WHY THIS EXISTS: the app is vanilla ES modules loaded with static imports. Python's
plain `http.server` sends no Cache-Control header, so Chrome applies HEURISTIC caching
and will serve a STALE prop.js / fins.js on an ordinary reload -- you edit the engine,
reload, and see the OLD geometry, with no hint anything is wrong. That has burned us
repeatedly ("kill the app and restart"). This server sends `Cache-Control: no-store`
on everything, so every reload fetches the current file. No hard-reload needed.

    cd ~/projects/support-fins/web && python3 dev-server.py        # -> http://localhost:8731
    python3 dev-server.py 8080                                     # custom port
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # quiet


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8731
    print(f"Support Fins dev server (no-cache) -> http://localhost:{port}")
    print("Every reload fetches fresh JS -- no hard-reload needed. Ctrl-C to stop.")
    ThreadingHTTPServer(("", port), NoCacheHandler).serve_forever()
