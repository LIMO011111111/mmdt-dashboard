#!/usr/bin/env python3
"""Baut eine Vorschau des Dashboards aus template.html + scripts/live_patch.js mit ERFUNDENEN Daten
(TUM_LIVE + GCAL_STATIC), ganz ohne Token/Netz. Nur fuer die Tests in tests/.

Aufruf:
  python3 tests/make_preview.py <root> <out.html> [--variant noceo|nodates] [--now YYYY-MM-DDTHH:MM:SS]

  <root>     Ordner mit template.html und scripts/live_patch.js (Repo-Wurzel oder ein Basis-Stand aus `git show`)
  --variant  noceo   = Kurs MGTHN0130 (CEO Strategy Series) abgewaehlt: keine Sessions mit Pruefung
             nodates = MGTHN0130 gewaehlt, aber ohne Einzeltermine (kein Session-Punkt in der Semesterleiste)
             crash   = v22: zusaetzlich ungueltige Termine (18:00-00:00 ueber Mitternacht, Ende vor Beginn, kaputtes Format)
             sose    = v22: Sommersemester 27S ("SoSe 2027"), aktuelle Kurse in Semester 3 (mit --now 2027-05-10T10:00:00)
             xss     = v22: boesartige Texte in TUM_LIVE und Kalender (HTML/Script), muessen escaped erscheinen
  --now      fester Zeitstempel (Berlin) fuer "built"/"stand". tests/run.sh gibt allen Builds denselben Wert, damit
             Basis- und Neu-Build byte-gleich sind, wo sich der Code nicht unterscheidet (kein Minutensprung dazwischen).

Alle Termine/Titel sind generische Platzhalter (Team-Meeting, Call Kunde, Sport ...): das Repo ist oeffentlich.
"""
import json, sys, os, argparse, datetime as dt
from zoneinfo import ZoneInfo

ap = argparse.ArgumentParser()
ap.add_argument("root"); ap.add_argument("out")
ap.add_argument("--variant", choices=["noceo", "nodates", "crash", "sose", "xss"])
ap.add_argument("--now")
args = ap.parse_args()
BERLIN = ZoneInfo("Europe/Berlin")   # unabhaengig von der Zeitzone des Rechners (CI laeuft in UTC)
NOW = dt.datetime.fromisoformat(args.now) if args.now else dt.datetime.now(BERLIN).replace(tzinfo=None, microsecond=0)

html = open(os.path.join(args.root, "template.html"), encoding="utf-8").read()
patch = open(os.path.join(args.root, "scripts", "live_patch.js"), encoding="utf-8").read()
today = NOW.date()
mon = today - dt.timedelta(days=today.weekday())
def iso(d, h, m=0): return dt.datetime.combine(d, dt.time(h, m), tzinfo=BERLIN).isoformat(timespec="seconds")
def dates(wd, h1, h2, n=12):
    return [f"{(mon + dt.timedelta(days=wd + 7*i)).strftime('%d.%m.%Y')} {h1:02d}:00-{h2:02d}:00" for i in range(-2, n)]
live = {
 "built": NOW.isoformat(timespec="seconds"), "semester": "26W", "semesterLabel": "WS 2026/27",
 "stand": today.strftime("%d.%m.%Y"), "offerStand": today.strftime("%Y-%m-%d"), "handbookStand": "2026-10-01",
 "ws": ["MGTHN0189","MGTHN0111","MGTHN0121","MGTHN0130","MGTHN0207","MGTHN0165","MGTHN0113","MGTHN0178","WIHN0013","MGTHN0150","INHN0012","CITHN2001"],
 "schedule": {
   "MGTHN0189": [{"d":0,"s":600,"e":780,"src":"TUMonline"}],
   "MGTHN0207": [{"d":1,"s":540,"e":720,"src":"TUMonline"},{"d":3,"s":840,"e":960,"src":"TUMonline"}],
   "MGTHN0121": [{"d":2,"s":780,"e":960,"src":"TUMonline"}],
   "MGTHN0130": [{"d":3,"s":1020,"e":1140,"src":"TUMonline"}],
   "MGTHN0178": [{"d":4,"s":600,"e":720,"src":"TUMonline"}],
 },
 "blocks": {"MGTHN0111": {"de":"Einzeltermine (TUMonline): Fr 06.11. 09:00-17:00, Sa 07.11. 09:00-17:00, Fr 20.11. 09:00-17:00","en":"Single dates: Fri 6 Nov 09:00-17:00, Sat 7 Nov, Fri 20 Nov"}},
 "skal": {
   "MGTHN0189": {"ort":"L.1.11","dates":dates(0,10,13)},
   "MGTHN0207": {"ort":"L.0.03","dates":dates(1,9,12)+dates(3,14,16)},
   "MGTHN0121": {"ort":"Online","dates":dates(2,13,16)},
   "MGTHN0130": {"ort":"Audimax","dates":dates(3,17,19)},
   "MGTHN0178": {"ort":"L.2.04","dates":dates(4,10,12)},
 },
 "exams": {"MGTHN0111": {"de":"Projektarbeit (Gruppenpräsentation + Bericht), keine Klausur.","en":"Project work, no written exam."}},
 "examDates": {"MGTHN0207": (today + dt.timedelta(days=110)).strftime("%d.%m.%Y")},
 "missingExam": ["MGTHN0113"],
 "me": {"cursem":"2","startSemester":"26S",
   "picked": {"MGTHN0150":"1","INHN0012":"1","CITHN2001":"1","WIHN0020":"1","MGTHN0189":"2","MGTHN0111":"2","MGTHN0121":"2","MGTHN0130":"2","MGTHN0207":"2","MGTHN0165":"2","MGTHN0113":"2"},
   "cs": {"MGTHN0150":{"s":"bestanden","g":"2,3"},"INHN0012":{"s":"bestanden","g":"1,0"},"CITHN2001":{"s":"bestanden","g":"2,7"},"WIHN0020":{"s":"bestanden","g":"1,7"},
          "MGTHN0189":{"s":"fixplatz","g":""},"MGTHN0111":{"s":"fixplatz","g":""},"MGTHN0121":{"s":"fixplatz","g":""},"MGTHN0130":{"s":"fixplatz","g":""},
          "MGTHN0207":{"s":"in_progress","g":""},"MGTHN0165":{"s":"fixplatz","g":""},"MGTHN0113":{"s":"warteliste","g":"","src":"moodle"}}}
}
ev = []
def add(d, h1, h2, title, loc="", all_day=False, wichtig=None, uni=False):
    ev.append({"id": title + str(d), "title": title, "start": iso(d,h1) if not all_day else d.isoformat(),
               "end": iso(d,h2) if not all_day else (d+dt.timedelta(days=1)).isoformat(), "allDay": all_day,
               "location": loc, "colorId":"", "code":"", "uni": uni, "online": "online" in loc.lower(), "free": False, "wichtig": wichtig})
add(today, 8, 9, "Team-Meeting", "Büro")
add(today, 10, 13, "Marketing Research (MGTHN0189)", "L.1.11", uni=True)
add(today, 14, 15, "Call Kunde", "Online")
add(today, 18, 20, "Sport", "Sporthalle")
add(today + dt.timedelta(days=1), 9, 12, "Causal Data Science VO (MGTHN0207)", "L.0.03", uni=True)
add(today + dt.timedelta(days=2), 0, 0, "Fotoshoot", all_day=True)
add(today + dt.timedelta(days=9), 23, 23, "DEADLINE MR: Case Study 1", wichtig={"kurs":"MR","was":"Case Study 1","abgabe":True}, uni=True)
add(today + dt.timedelta(days=30), 10, 12, "Präsentation Industry 4.0", "L.2.04", wichtig={"kurs":"Industry 4.0","was":"Präsentation","abgabe":False}, uni=True)
add(today + dt.timedelta(days=80), 9, 11, "Klausur Causal Data Science", "Audimax", wichtig={"kurs":"Causal Data Science","was":"Klausur","abgabe":False}, uni=True)
gcal = {"stand": NOW.isoformat(timespec="minutes"), "events": ev}
if args.variant == "noceo":      # CEO Strategy Series nicht gewaehlt
    live["me"]["picked"].pop("MGTHN0130"); live["me"]["cs"].pop("MGTHN0130")
elif args.variant == "nodates":  # gewaehlt, aber ohne Einzeltermine
    live["skal"]["MGTHN0130"]["dates"] = []
if args.variant == "crash":     # v22: ungueltige Termine duerfen die Seite nicht lahmlegen
    nx = mon + dt.timedelta(days=7)
    live["skal"]["MGTHN0189"]["dates"] += [(nx + dt.timedelta(days=2)).strftime("%d.%m.%Y") + " 18:00-00:00",
                                           (nx + dt.timedelta(days=3)).strftime("%d.%m.%Y") + " 20:00-19:00", "kaputt", "31.02.2027 10:00-12:00"]
elif args.variant == "sose":    # v22: Sommersemester statt fest WS 26/27
    live.update({"semester": "27S", "semesterLabel": "SoSe 2027"})
    live["me"]["cursem"] = "3"
    for c, sm in list(live["me"]["picked"].items()):
        if sm == "2":
            live["me"]["picked"][c] = "3"
elif args.variant == "xss":     # v22: Texte aus Build/Kalender sind Daten, nie HTML
    X = '<img src=x onerror="window.__xss=(window.__xss||0)+1">'
    BRK = "</script><script>window.__xss=(window.__xss||0)+100;document.title='PWNED'</script>\u2028"   # v22: Ausbruch aus <script>
    Y = '"><svg onload="window.__xss=1"><b x="'
    live["blocks"]["MGTHN0111"] = {"de": "Block " + X, "en": "Block " + X}
    live["exams"]["MGTHN0111"] = {"de": "Projekt " + X, "en": "Project " + Y}
    live["skal"]["MGTHN0189"]["ort"] = "L.1.11 " + X
    live["skal"]["MGTHN0189"].update({"hinweis": {"de": "Hinweis " + X, "en": Y}, "beschreibung": "Text " + Y, "pruefung": X, "klausur": "ja " + X,
                                      "bewerbung": {"link": "javascript:window.__xss=1", "mail": Y, "frist": X, "text": {"de": X, "en": X}},
                                      "status": "<b>x</b>", "ects": X, "name": X})
    live["semesterLabel"] = X
    live["stand"] = live["stand"] + BRK
    for e in ev:
        e["title"] = e["title"] + " " + X + " " + BRK
        e["location"] = (e["location"] or "") + " " + Y
        if e["wichtig"]:
            e["wichtig"] = {"kurs": X, "was": Y, "abgabe": True}
def script_json(o):   # v22: wie scripts/build_dashboard.py: </script> u. a. in Texten koennen nicht ausbrechen
    j = json.dumps(o, ensure_ascii=False)
    return j.replace("&", "\\u0026").replace("<", "\\u003c").replace(">", "\\u003e").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
block = ("\nconst TUM_LIVE = " + script_json(live) + ";\n" + patch + "\n"
         "const GCAL_STATIC = " + script_json(gcal) + ";\n")
marker = "document.addEventListener('DOMContentLoaded', init);"
assert marker in html
open(args.out, "w", encoding="utf-8").write(html.replace(marker, marker + block, 1))
print("written", args.out)
