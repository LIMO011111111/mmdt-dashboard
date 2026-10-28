#!/usr/bin/env python3
"""Small home-network server for the dashboard: static files from data/ plus the two endpoints the page
uses when it is opened over http instead of as a file. Python standard library only.

    python3 scripts/serve.py                 # http://<this-machine>:8080/dashboard.html
    python3 scripts/serve.py --port 8081 --bind 127.0.0.1

What it adds on top of a plain static server:
  GET/PUT /api/mmdt-state   device sync: the dashboard keeps its own entries (status, notes, to-dos, plans)
                            here as data/mmdt-state.json, so phone and laptop show the same thing.
                            Newer timestamp wins; the page does the merging, the server only stores.
  GET      /api/kalender    your Google Calendar (read-only), refreshed at most every 10 minutes through
                            scripts/gcal.py. Needs GOOGLE_CAL_ICS_URL in .env; otherwise 404 and the
                            page falls back to the calendar baked in at build time.

The dashboard contains your grades and appointments: keep this server inside your home network (the
default binds to all interfaces so your phone can reach it; use --bind 127.0.0.1 for this machine only)
and never expose it to the internet without authentication in front of it.
"""
import argparse
import json
import os
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gcal  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAX_STATE_BYTES = 2 * 1024 * 1024
CAL_MAX_AGE = 10 * 60          # seconds between two calendar fetches
CAL_RETRY = 60                 # seconds before retrying after a failed fetch
TS_SLACK_MS = 5 * 60 * 1000    # a device clock may be this far ahead; anything beyond is clamped


def write_atomic(path, text):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(text)
    os.replace(tmp, path)


class Calendar:
    """gcal.fetch() with a small cache, shared by all requests."""
    def __init__(self):
        self.lock = threading.Lock()
        self.data, self.at = None, 0.0

    def get(self):
        if not gcal.configured():
            return None
        with self.lock:
            if time.time() - self.at > CAL_MAX_AGE:   # self.at starts at 0, so the first request fetches
                try:
                    self.data, self.at = gcal.fetch(), time.time()
                except Exception as ex:   # offline, package missing: keep the last good copy if there is one
                    print(f"calendar: {ex}", file=sys.stderr)
                    self.at = time.time() - CAL_MAX_AGE + CAL_RETRY   # do not hammer the network on every request
            return self.data


class Handler(SimpleHTTPRequestHandler):
    calendar = Calendar()
    state_path = ""
    state_lock = threading.Lock()

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/mmdt-state":
            try:
                with open(self.state_path, encoding="utf-8") as fh:
                    return self._json(200, json.load(fh))
            except (OSError, ValueError):
                return self._json(200, {"ts": 0, "state": None})
        if path == "/api/kalender":
            cal = self.calendar.get()
            return self._json(200, cal) if cal else self._json(404, {"error": "no calendar configured"})
        if path in ("/", "/index.html"):
            self.path = "/dashboard.html"
        return super().do_GET()

    def do_PUT(self):
        if self.path.split("?", 1)[0] != "/api/mmdt-state":
            return self._json(404, {"error": "not found"})
        if "Content-Length" not in self.headers:
            return self._json(411, {"error": "Content-Length required"})
        try:
            n = int(self.headers.get("Content-Length", "0"))
            if n <= 0 or n > MAX_STATE_BYTES:
                return self._json(413, {"error": "state too large"})
            data = json.loads(self.rfile.read(n).decode("utf-8"))
            if not isinstance(data, dict) or not isinstance(data.get("state"), dict):
                raise ValueError("expected {\"ts\": <ms>, \"state\": {...}}")
            ts = int(data.get("ts") or 0)
            ts = max(0, min(ts, int(time.time() * 1000) + TS_SLACK_MS))   # a wrong clock must not lock out every other device
        except (ValueError, TypeError, OverflowError, UnicodeDecodeError) as ex:
            return self._json(400, {"error": str(ex)})
        with self.state_lock:
            try:
                with open(self.state_path, encoding="utf-8") as fh:
                    cur = int(json.load(fh).get("ts") or 0)
            except (OSError, ValueError):
                cur = 0
            if ts >= cur:   # the page only pushes what is newer than what it pulled; an older device never wins
                write_atomic(self.state_path, json.dumps({"ts": ts, "state": data["state"]}, ensure_ascii=False))
        return self._json(200, {"ok": True, "ts": max(ts, cur)})

    def end_headers(self):
        if urlsplit(getattr(self, "path", "")).path.endswith(".html"):
            self.send_header("Cache-Control", "no-cache")   # always the freshly built dashboard
        super().end_headers()

    def log_message(self, fmt, *args):   # the page polls /api/ often: keep the log readable
        if not getattr(self, "path", "").startswith("/api/"):
            super().log_message(fmt, *args)


def main():
    p = argparse.ArgumentParser(description="Serve the dashboard inside your home network")
    p.add_argument("--port", type=int, default=8080)
    p.add_argument("--bind", default="0.0.0.0", help="127.0.0.1 = this machine only")
    p.add_argument("--dir", default=os.path.join(ROOT, "data"), help="folder with dashboard.html")
    a = p.parse_args()
    if not os.path.isfile(os.path.join(a.dir, "dashboard.html")):
        sys.exit(f"{a.dir}/dashboard.html not found: run scripts/build_dashboard.py first")
    Handler.state_path = os.path.join(a.dir, "mmdt-state.json")
    handler = lambda *x, **k: Handler(*x, directory=a.dir, **k)   # noqa: E731
    srv = ThreadingHTTPServer((a.bind, a.port), handler)
    print(f"Dashboard: http://{a.bind if a.bind != '0.0.0.0' else '<this-machine>'}:{a.port}/dashboard.html  "
          f"(sync in {Handler.state_path}, calendar {'on' if gcal.configured() else 'off'})", file=sys.stderr)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
