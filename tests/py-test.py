#!/usr/bin/env python3
"""v22: Robustheit der Python-Skripte ohne Netz und ohne Token (nur erfundene Daten).

    python3 tests/py-test.py

Prueft: tumonline.api() macht aus Wartungsseite/leerer Antwort/Timeout/HTTP-Fehler eine TumonlineError (1 Wiederholung bei
Timeout und 5xx), build_dashboard.load_offer() macht nach einem kaputten Modul weiter und schreibt den Cache laufend und atomar,
main() baut trotz kaputtem Kursangebot/Modulhandbuch, Termine ueber Mitternacht enden um 24:00, handbook.load() loescht ein
kaputtes PDF und laedt es beim naechsten Lauf neu (Download erst in .tmp). Ausgabe wie die JS-Suites: "<n> FAIL / <m>".
"""
import io
import json
import os
import socket
import sys
import tempfile
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import tumonline as tum  # noqa: E402
import build_dashboard as bd  # noqa: E402
import handbook  # noqa: E402
import gcal  # noqa: E402

results = []


def ok(name, cond, info=""):
    results.append(("OK  " if cond else "FAIL", name, info))


class Resp:
    def __init__(self, body): self.b = body
    def read(self): return self.b
    def __enter__(self): return self
    def __exit__(self, *a): pass


tum.TOKEN = "geheim-123"
tum.time.sleep = lambda s: None
real_urlopen = urllib.request.urlopen


def with_urlopen(fn, call):
    urllib.request.urlopen = fn
    try:
        return call()
    finally:
        urllib.request.urlopen = real_urlopen


def raises(call):
    try:
        call()
        return None
    except Exception as e:  # noqa: BLE001
        return e


# ---------------------------------------------------------------- 1) tumonline.api
e = with_urlopen(lambda url, timeout=30: Resp(b"<html><body>Wartung<br></body></html>"), lambda: raises(lambda: tum.api("noten")))
ok("api: HTML-Wartungsseite -> TumonlineError", isinstance(e, tum.TumonlineError), repr(e))
e = with_urlopen(lambda url, timeout=30: Resp(b""), lambda: raises(lambda: tum.api("noten")))
ok("api: leere Antwort -> TumonlineError", isinstance(e, tum.TumonlineError), repr(e))
calls = {"n": 0}


def flaky_timeout(url, timeout=30):
    calls["n"] += 1
    if calls["n"] == 1:
        raise socket.timeout("timed out")
    return Resp(b"<rows><row><a>1</a></row></rows>")


r = with_urlopen(flaky_timeout, lambda: tum.api("noten"))
ok("api: 1 Timeout -> 1 Wiederholung, dann Erfolg", calls["n"] == 2 and r.tag == "rows", str(calls))
calls["n"] = 0


def always_timeout(url, timeout=30):
    calls["n"] += 1
    raise socket.timeout("timed out")


e = with_urlopen(always_timeout, lambda: raises(lambda: tum.api("noten")))
ok("api: 2 Timeouts -> TumonlineError (genau 2 Versuche)", isinstance(e, tum.TumonlineError) and calls["n"] == 2, f"{e!r} {calls}")
calls["n"] = 0


def http(code):
    def f(url, timeout=30):
        calls["n"] += 1
        raise urllib.error.HTTPError(url, code, "err", {}, io.BytesIO(b""))
    return f


e = with_urlopen(http(503), lambda: raises(lambda: tum.api("noten")))
ok("api: HTTP 503 -> 1 Wiederholung, dann TumonlineError", isinstance(e, tum.TumonlineError) and calls["n"] == 2, f"{e!r} {calls}")
calls["n"] = 0
e = with_urlopen(http(404), lambda: raises(lambda: tum.api("noten")))
ok("api: HTTP 404 -> sofort TumonlineError", isinstance(e, tum.TumonlineError) and calls["n"] == 1, f"{e!r} {calls}")
e = with_urlopen(lambda url, timeout=30: (_ for _ in ()).throw(urllib.error.URLError("geheim-123 down")), lambda: raises(lambda: tum.api("noten")))
ok("api: URLError -> TumonlineError, Token nicht im Text", isinstance(e, tum.TumonlineError) and "geheim-123" not in str(e), repr(e))
e = with_urlopen(lambda url, timeout=30: Resp(b"<rows></rows>") if "Details" not in url else (_ for _ in ()).throw(socket.timeout("t")),
                 lambda: raises(lambda: tum.details("123")))
ok("details: Timeout -> TumonlineError", isinstance(e, tum.TumonlineError), repr(e))

# ---------------------------------------------------------------- 2) load_offer: weitermachen, Cache laufend + atomar
tmp = tempfile.mkdtemp()
bd.ROOT = tmp
seen = []


def fake_module(code, semester, name):
    seen.append(code)
    cache = os.path.join(tmp, "data", f"offer-{semester}.json")
    if code == "MGTHN0112":
        raise socket.timeout("timed out")
    if code == "MGTHN0150":   # beim 4. Modul muss der Cache schon die ersten beiden enthalten
        with open(cache, encoding="utf-8") as fh:
            seen.append(sorted(json.load(fh)["modules"]))
    if code == "MGTHN0175":
        raise ET.ParseError("kaputtes XML")
    return {"code": code, "name": name, "semester": semester, "matched_by": "code",
            "parts": [{"appointments": [{"date": "2026-10-14", "weekday": "We", "start": "18:00", "end": "00:00", "room": "L.1.11"}]}]}


real_module = tum.module
tum.module = fake_module
codes = [("MGTHN0105", "A"), ("MGTHN0107", "B"), ("MGTHN0112", "C"), ("MGTHN0150", "D"), ("MGTHN0175", "E")]
try:
    off = bd.load_offer("26W", codes, 7, True)
    err = None
except Exception as ex:  # noqa: BLE001
    off, err = None, ex
ok("load_offer: Timeout/ParseError bei einzelnen Modulen -> kein Abbruch, alle Module versucht", err is None and [c for c in seen if isinstance(c, str)] == [c for c, _ in codes], repr(err))
ok("load_offer: Cache waehrend des Laufs geschrieben (vor Modul 4 schon Modul 1+2)", ["MGTHN0105", "MGTHN0107"] in seen, str(seen))
cache = os.path.join(tmp, "data", "offer-26W.json")
data = json.load(open(cache, encoding="utf-8"))
ok("load_offer: Cache am Ende ohne die fehlgeschlagenen Module (naechster Lauf holt sie)", sorted(data["modules"]) == ["MGTHN0105", "MGTHN0107", "MGTHN0150"], str(sorted(data["modules"])))
ok("load_offer: Rueckgabe nennt die fehlgeschlagenen Module", off and off.get("failed") == ["MGTHN0112", "MGTHN0175"], str(off and off.get("failed")))
ok("load_offer: keine .tmp-Reste", not [f for f in os.listdir(os.path.join(tmp, "data")) if f.endswith(".tmp")])
seen.clear()
off2 = bd.load_offer("26W", codes, 7, False)
ok("load_offer: naechster Lauf holt nur die fehlenden Module", [c for c in seen if isinstance(c, str)] == ["MGTHN0112", "MGTHN0175"], str(seen))
tum.module = real_module

# ---------------------------------------------------------------- 3) Termine ueber Mitternacht
e = bd.skal_entry([("2026-10-14", "18:00", "00:00", "L.1.11"), ("2026-10-15", "22:00", "01:30", ""), ("2026-10-16", "10:00", "12:00", "")])
ok("skal_entry: Ende <= Beginn -> 24:00", e["dates"] == ["14.10.2026 18:00-24:00", "15.10.2026 22:00-24:00", "16.10.2026 10:00-12:00"], str(e["dates"]))
sl = bd.weekly_slots([("2026-10-14", "18:00", "00:00", ""), ("2026-10-21", "18:00", "00:00", ""), ("2026-10-28", "18:00", "00:00", "")])
ok("weekly_slots: Ende 00:00 -> 1440", sl == [{"d": 2, "s": 1080, "e": 1440}], str(sl))
bt = bd.block_text([("2026-10-14", "18:00", "00:00", "")])
ok("block_text: 18:00-24:00", "18:00-24:00" in bt["de"], bt["de"])

# ---------------------------------------------------------------- 4) main(): Kursangebot und Handbuch kaputt -> trotzdem bauen
tmp2 = tempfile.mkdtemp()
os.makedirs(os.path.join(tmp2, "data"))
bd.ROOT = tmp2
EMPTY = {"noten": "<rows><row><lv_nummer>MGTHN0150</lv_nummer><uninotenamekurz>2,3</uninotenamekurz><lv_semester>26S</lv_semester>"
                  "<datum>2026-07-20</datum></row></rows>",
         "pruefungenEigene": "<rows></rows>",
         "kalender": "<events><event><title>Marketing Research (MGTHN0189)</title><description>fix</description>"
                     "<dtstart>2026-10-14 18:00:00</dtstart><dtend>2026-10-15 00:00:00</dtend><location>L.1.11</location></event></events>"}
real_retry, real_load_offer, real_hb = tum.api_retry, bd.load_offer, handbook.load
tum.api_retry = lambda ep, **p: ET.fromstring(EMPTY[ep])
bd.load_offer = lambda *a, **k: (_ for _ in ()).throw(tum.TumonlineError("TUMonline down"))
handbook.load = lambda *a, **k: (_ for _ in ()).throw(OSError("PDF kaputt"))
gcal.configured = lambda: False
out = os.path.join(tmp2, "data", "dashboard.html")
sys.argv = ["x", "--template", os.path.join(ROOT, "template.html"), "--out", out]
old_stdout, sys.stdout = sys.stdout, io.StringIO()
try:
    bd.main()
    err = None
except BaseException as ex:  # noqa: BLE001
    err = ex
finally:
    rep, sys.stdout = sys.stdout.getvalue(), old_stdout
ok("main: Kursangebot + Handbuch kaputt -> Dashboard trotzdem gebaut", err is None and os.path.exists(out), repr(err))
html = open(out, encoding="utf-8").read() if os.path.exists(out) else ""
live = json.loads(html.split("const TUM_LIVE = ", 1)[1].split(";\n", 1)[0]) if "const TUM_LIVE = " in html else {}
ok("main: Noten + Kalender drin (MGTHN0150 bestanden, MGTHN0189 18:00-24:00)",
   live.get("me", {}).get("cs", {}).get("MGTHN0150", {}).get("s") == "bestanden" and live.get("skal", {}).get("MGTHN0189", {}).get("dates") == ["14.10.2026 18:00-24:00"],
   json.dumps(live.get("skal", {}))[:120])
ok("main: Bericht nennt die Warnungen", "## Warnings" in rep and "course offer skipped" in rep and "handbook skipped" in rep, rep[-200:])
tum.api_retry, bd.load_offer, handbook.load = real_retry, real_load_offer, real_hb

# ---------------------------------------------------------------- 5) handbook: kaputtes PDF, Download ueber .tmp
d = tempfile.mkdtemp()
mhb = os.path.join(d, "mhb")
os.makedirs(mhb)
broken = os.path.join(mhb, "Modulhandbuch_MMDT.pdf")
open(broken, "wb").write(b"%PDF-1.7\n1 0 obj")   # abgebrochener Download
handbook.listed_documents = lambda url: [("1", "Modulhandbuch MMDT.pdf")]
real_pdf_text = handbook.pdf_text
handbook.pdf_text = lambda p: (_ for _ in ()).throw(ValueError("Stream has ended unexpectedly"))
try:
    r = handbook.load(mhb)
    err = None
except Exception as ex:  # noqa: BLE001
    r, err = None, ex
ok("handbook: kaputtes PDF -> kein Abbruch, leeres Ergebnis", err is None and r is not None and r["exams"] == {}, repr(err))
ok("handbook: kaputtes PDF geloescht (wird neu geladen)", not os.path.exists(broken))
handbook.pdf_text = lambda p: "Generiert am 01.10.2026\nMGTHN0150: Testmodul | x\nBeschreibung der Studien-/ Prüfungsleistungen:\nKlausur 60 Min.\nWiederholungsmöglichkeit:\n"
writes = []


def dl(url, timeout=300):
    writes.append(sorted(os.listdir(mhb)))
    return Resp(b"%PDF-1.7 vollstaendig")


r = with_urlopen(dl, lambda: handbook.load(mhb))
ok("handbook: naechster Lauf laedt neu (ueber .tmp, danach umbenannt) und liest", os.path.exists(broken) and r["exams"].get("MGTHN0150", {}).get("de") == "Klausur 60 Min."
   and not [f for f in os.listdir(mhb) if f.endswith(".tmp")], str(r and r["exams"]))
os.remove(broken)
r = with_urlopen(lambda url, timeout=300: Resp(b"<html>Fehler</html>"), lambda: handbook.load(mhb))
ok("handbook: Fehlerseite statt PDF wird nicht gespeichert", not os.path.exists(broken) and not os.listdir(mhb) == ["Modulhandbuch_MMDT.pdf"], str(os.listdir(mhb)))
open(os.path.join(mhb, "handbook.json"), "w").write("{kaputt")
handbook.listed_documents = lambda url: (_ for _ in ()).throw(OSError("offline"))
r = handbook.load(mhb)
ok("handbook: kaputter Cache wird ignoriert", isinstance(r, dict))
handbook.pdf_text = real_pdf_text

# ---------------------------------------------------------------- 6) v22-Nachbesserung
# (1) </script> in Kalender-/Kursdaten bricht beim Einbetten nicht aus
import subprocess  # noqa: E402
EVIL = "</script><script>window.__pwn=1;document.title='PWNED'</script>\u2028x\u2029&<!--"
tmp3 = tempfile.mkdtemp(); os.makedirs(os.path.join(tmp3, "data")); bd.ROOT = tmp3
tum.api_retry = lambda ep, **p: ET.fromstring({"noten": "<rows></rows>", "pruefungenEigene": "<rows></rows>", "kalender": "<events></events>"}[ep])
bd.load_offer = lambda *a, **k: {"fetched_at": "", "modules": {"MGTHN0189": {"parts": [{"appointments": [{"date": "2026-10-14", "start": "10:00", "end": "12:00", "room": EVIL}]}]}}}
handbook.load = lambda *a, **k: {"stand": "", "exams": {}, "modules": {}}
gcal.configured = lambda: True
gcal.fetch = lambda: {"stand": "2026-10-29T10:00", "events": [{"id": "e1", "title": "Team-Meeting " + EVIL, "start": "2026-10-29T10:00:00+01:00", "end": "2026-10-29T11:00:00+01:00",
                                                                 "allDay": False, "location": EVIL, "colorId": "", "code": "", "uni": False, "online": False, "free": False, "wichtig": None}]}
out3 = os.path.join(tmp3, "data", "dashboard.html")
sys.argv = ["x", "--template", os.path.join(ROOT, "template.html"), "--out", out3]
old_stdout, sys.stdout = sys.stdout, io.StringIO()
try:
    bd.main()
finally:
    sys.stdout = old_stdout
h3 = open(out3, encoding="utf-8").read()
tail = h3[h3.index("document.addEventListener('DOMContentLoaded', init);"):]
gc = json.loads(tail.split("const GCAL_STATIC = ", 1)[1].split(";\n", 1)[0])
lv = json.loads(tail.split("const TUM_LIVE = ", 1)[1].split(";\n", 1)[0])
ok("Einbetten: kein '</script>'/'<!--' und kein U+2028/U+2029 roh im eingebetteten Block", "</script><script>" not in tail and "<!--" not in tail.split("</script>")[0]
   and "\u2028" not in tail and tail.count("</script>") == 1, tail[:0])
ok("Einbetten: Werte unveraendert (Titel, Ort aus Kursangebot)", gc["events"][0]["title"].endswith(EVIL) and lv["skal"]["MGTHN0189"]["ort"] == EVIL.split(",")[0], gc["events"][0]["title"][-30:])
demo = os.path.join(tmp3, "demo.html")
subprocess.run([sys.executable, os.path.join(ROOT, "scripts", "make_demo.py"), out3, demo], check=True, capture_output=True)
dt = open(demo, encoding="utf-8").read()
ok("make_demo: ebenfalls sicher eingebettet", "</script><script>window.__pwn" not in dt and dt.count("const TUM_LIVE") == 1)
tum.api_retry, bd.load_offer, handbook.load = real_retry, real_load_offer, real_hb

# (7) Kursangebot: TUMonline ganz down -> alter Cache bleibt (auch bei --refresh-offer und abgelaufenem Cache)
tmp4 = tempfile.mkdtemp(); os.makedirs(os.path.join(tmp4, "data")); bd.ROOT = tmp4
good = {"code": "A", "name": "A", "semester": "26W", "matched_by": "code", "parts": []}
cpath = os.path.join(tmp4, "data", "offer-26W.json")
json.dump({"semester": "26W", "fetched_at": "2026-10-01T10:00:00", "modules": {"MGTHN0105": good, "MGTHN0107": good}}, open(cpath, "w"))
tum.module = lambda *a, **k: (_ for _ in ()).throw(tum.TumonlineError("down"))
two = [("MGTHN0105", "x"), ("MGTHN0107", "y")]
o1 = bd.load_offer("26W", two, 7, True)
o2 = bd.load_offer("26W", two, 7, False)
disk = json.load(open(cpath))
ok("Kursangebot: TUMonline down (--refresh-offer, Cache alt) -> Build bekommt alten Stand, Cache unveraendert",
   sorted(o1["modules"]) == sorted(o2["modules"]) == ["MGTHN0105", "MGTHN0107"] and sorted(disk["modules"]) == ["MGTHN0105", "MGTHN0107"] and disk["fetched_at"] == "2026-10-01T10:00:00",
   f"{sorted(o1['modules'])} {sorted(o2['modules'])} {sorted(disk['modules'])}")
calls4 = []
tum.module = lambda code, sem, name: calls4.append(code) or (good if code == "MGTHN0105" else (_ for _ in ()).throw(tum.TumonlineError("down")))
o3 = bd.load_offer("26W", two, 7, True)
disk = json.load(open(cpath))
ok("Kursangebot: teils down -> neuer Stand + alter als Rueckfall (stale), naechster Lauf holt nur den alten nach",
   sorted(disk["modules"]) == ["MGTHN0105", "MGTHN0107"] and disk.get("stale") == ["MGTHN0107"] and sorted(o3["modules"]) == ["MGTHN0105", "MGTHN0107"], json.dumps(disk.get("stale")))
calls4.clear()
bd.load_offer("26W", two, 7, False)
ok("Kursangebot: stale-Modul wird beim naechsten Lauf erneut geholt", calls4 == ["MGTHN0107"], str(calls4))
tum.module = real_module

# (8) abgebrochene Antwort (IncompleteRead) -> 1 Wiederholung, dann TumonlineError
import http.client  # noqa: E402
calls["n"] = 0


def incomplete(url, timeout=30):
    calls["n"] += 1
    raise http.client.IncompleteRead(b"<rows>", 494)


e = with_urlopen(incomplete, lambda: raises(lambda: tum.api("noten")))
ok("api: IncompleteRead -> 1 Wiederholung, dann TumonlineError", isinstance(e, tum.TumonlineError) and calls["n"] == 2, f"{e!r} {calls}")
calls["n"] = 0


def incomplete_once(url, timeout=30):
    calls["n"] += 1
    if calls["n"] == 1:
        raise http.client.IncompleteRead(b"<rows>", 494)
    return Resp(b"<rows></rows>")


r = with_urlopen(incomplete_once, lambda: tum.api("noten"))
ok("api: IncompleteRead einmal -> zweiter Versuch klappt", r.tag == "rows" and calls["n"] == 2)

for st, name, info in results:
    print(st, name, ("— " + str(info)[:240]) if info and st == "FAIL" else "")
fails = sum(1 for r in results if r[0] == "FAIL")
print(f"{fails} FAIL / {len(results)}")
sys.exit(1 if fails else 0)
