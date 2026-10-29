#!/usr/bin/env python3
"""Make a shareable demo copy of the built dashboard: same courses and timetable, but the personal
grades are replaced by example values and the status line says "Demo". Nothing else personal is in
the dashboard (no name, no student id, no token).

    python scripts/make_demo.py [data/dashboard.html] [data/demo/dashboard-demo.html]
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_dashboard import script_json  # noqa: E402  (v22: sicher in <script> einbetten)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "data", "dashboard.html")
out_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, "data", "demo", "dashboard-demo.html")
DEMO_GRADES = ["1,3", "1,7", "2,0", "2,3", "1,0", "2,7"]

html = open(src_path, encoding="utf-8").read()
m = re.search(r"const TUM_LIVE = (\{.*?\});\n", html)
if not m:
    sys.exit("TUM_LIVE block not found; build the dashboard first")
live = json.loads(m.group(1))
i = 0
for code, cs in live["me"]["cs"].items():
    if cs.get("s") == "bestanden":
        cs["g"] = DEMO_GRADES[i % len(DEMO_GRADES)]
        i += 1
live["stand"] = live["stand"] + " · Demo"
html = html[:m.start(1)] + script_json(live) + html[m.end(1):]
html = html.replace("<title>MMDT · Study Dashboard</title>", "<title>MMDT · Study Dashboard (Demo)</title>", 1)
os.makedirs(os.path.dirname(out_path), exist_ok=True)
open(out_path, "w", encoding="utf-8").write(html)
print(f"Demo written: {out_path} ({i} grades replaced)")
