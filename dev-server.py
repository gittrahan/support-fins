#!/usr/bin/env python3
"""
Dev server for web/. Plain static files -- the app has no build step -- but with
caching turned OFF.

`python3 -m http.server` serves Last-Modified and no Cache-Control, so browsers
apply heuristic caching to ES modules. Editing a module and reloading then runs
the OLD code, which looks exactly like a logic bug and wastes an afternoon.

    python3 dev-server.py [port]        # http://localhost:8731/
"""
import functools
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):        # one line per request, no noise
        sys.stderr.write(f"{self.command} {self.path} -> {args[1]}\n")


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8731
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'web')
    handler = functools.partial(NoCacheHandler, directory=root)
    print(f"support-fins dev server: http://localhost:{port}/  (serving {root})")
    http.server.ThreadingHTTPServer(('127.0.0.1', port), handler).serve_forever()


if __name__ == '__main__':
    main()
