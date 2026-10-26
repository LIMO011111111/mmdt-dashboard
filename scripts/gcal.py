"""Optional: your Google Calendar (read-only) for the dashboard, through its secret iCal address.

Why: the Today view shows what is next, the weekly plan gets your real appointments, and the bar at the top
shows where you are in the semester with a red dot for every graded deadline or presentation.

Setup (once): Google Calendar -> Settings -> your calendar -> "Integrate calendar" -> "Secret address in iCal
format". Paste it into .env as GOOGLE_CAL_ICS_URL=... The address only allows reading. Anyone who knows it can
read that calendar, so keep it in .env (git ignores it) and never post it. You can reset it in the same place.

Needs: pip install icalendar recurring-ical-events
For testing without Google: GOOGLE_CAL_ICS_FILE=/path/to/calendar.ics

Which appointments become red dots is decided by the title only (lists below, edit them if you like):
"DEADLINE ...", "Abgabe ...", or words like presentation / exam / assignment / submission in the title.
Everything is read; nothing is ever written to your calendar.
"""
import datetime as dt
import os
import re
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# graded or hard deadlines -> red dot on the semester bar
IMPORTANT = re.compile(r"abgabe|deadline|submission|due\b|pr[äa]sentation|presentation|pr[üu]fung|klausur|exam|assignment", re.I)
# ... unless the title says it is only organisational
NOT_GRADED = re.compile(r"anmeld|registration|kick-?off|team ?up", re.I)
PREFIX = re.compile(r"^(DEADLINE|ABGABE)\s*[:\-]?\s+", re.I)
MODULE_CODE = re.compile(r"\b([A-Z]{2,6}\d{4,6}[A-Z]?)\b")
ONLINE = re.compile(r"\b(online|zoom|teams|webex|virtuell|remote)\b", re.I)

NEAR_BACK, NEAR_AHEAD = 7, 60          # all appointments in this window (days)
FAR_BACK, FAR_AHEAD = 120, 200         # outside of it only the important ones


def _env(name):
    if os.environ.get(name):
        return os.environ[name].strip()
    try:
        with open(os.path.join(ROOT, ".env"), encoding="utf-8") as fh:
            for line in fh:
                if line.startswith(name + "="):
                    return line.split("=", 1)[1].strip().strip("\"'")
    except OSError:
        pass
    return ""


def configured():
    return bool(_env("GOOGLE_CAL_ICS_URL") or _env("GOOGLE_CAL_ICS_FILE"))


def _read_ics():
    path = _env("GOOGLE_CAL_ICS_FILE")
    if path:
        with open(path, "rb") as fh:
            return fh.read()
    url = _env("GOOGLE_CAL_ICS_URL")
    if not re.match(r"^https://calendar\.google\.com/", url):
        raise ValueError("GOOGLE_CAL_ICS_URL should start with https://calendar.google.com/")
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "mmdt-dashboard"}), timeout=30) as r:
        return r.read()


def classify(title):
    """None, or {"kurs", "was", "abgabe"} when the title looks like a graded appointment."""
    plain = PREFIX.sub("", title).strip()
    course, sep, what = plain.partition(":")
    if not sep:
        course, what = "", plain
    if not (PREFIX.match(title) or IMPORTANT.search(plain)) or NOT_GRADED.search(plain):
        return None
    return {"kurs": course.strip(), "was": what.strip(), "abgabe": bool(PREFIX.match(title))}


def fetch():
    """{"stand": iso, "events": [...]} in the shape the dashboard reads (same as the Pi version)."""
    import icalendar
    import recurring_ical_events

    cal = icalendar.Calendar.from_ical(_read_ics())
    now = dt.datetime.now().astimezone()
    window = (now - dt.timedelta(days=FAR_BACK), now + dt.timedelta(days=FAR_AHEAD))
    near = ((now - dt.timedelta(days=NEAR_BACK)).date(), (now + dt.timedelta(days=NEAR_AHEAD)).date())
    out = []
    for e in recurring_ical_events.of(cal).between(*window):
        title = str(e.get("SUMMARY", "")) or "(no title)"
        start, end = e["DTSTART"].dt, (e.get("DTEND") or e["DTSTART"]).dt
        all_day = not isinstance(start, dt.datetime)
        day = start if all_day else start.astimezone().date()
        w = classify(title)
        if not w and not (near[0] <= day <= near[1]):
            continue
        place = str(e.get("LOCATION", ""))
        iso = (lambda x: x.isoformat() if all_day else x.astimezone().isoformat(timespec="seconds"))
        out.append({
            "id": str(e.get("UID", "")) + iso(start),
            "title": title, "start": iso(start), "end": iso(end), "allDay": all_day,
            "location": place, "colorId": "",
            "code": (MODULE_CODE.search(title + " " + str(e.get("DESCRIPTION", ""))) or [None, ""])[1],
            "uni": bool(w or MODULE_CODE.search(title)),
            "online": bool(ONLINE.search(place + " " + title)),
            "free": str(e.get("TRANSP", "")).upper() == "TRANSPARENT",
            "wichtig": w,
        })
    out.sort(key=lambda x: x["start"])
    return {"stand": now.isoformat(timespec="minutes"), "events": out}


if __name__ == "__main__":
    data = fetch()
    print(f"{len(data['events'])} appointments, {sum(1 for e in data['events'] if e['wichtig'])} red dots", file=sys.stderr)
