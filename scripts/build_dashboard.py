#!/usr/bin/env python3
"""Build the MMDT Study Dashboard from live TUMonline data.

    python scripts/build_dashboard.py [--semester 26W] [--out data/dashboard.html] [--refresh-offer]

What it does, in order:
  1. Personal data (every run, a few seconds): grades, exam registrations, and your personal
     TUMonline calendar (= courses with a fixed place, all dates and rooms).
  2. Course offer of the semester (cached in data/offer-<semester>.json, refreshed when older
     than --offer-max-age days or with --refresh-offer; a full refresh takes a few minutes).
  3. Exam formats from the module handbook (data/mhb/processed/*.md, see scripts/handbook.py).
  4. Writes template.html + one generated <script> block (TUM_LIVE) to --out and a short report.

Your token is read by scripts/tumonline.py from .env and is never written into the dashboard.
"""
import argparse
import json
import os
import re
import sys
import time
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from datetime import date, datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tumonline as tum  # noqa: E402
import handbook  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATE = os.path.join(ROOT, "template.html")
MODULE_CODE = re.compile(r"\b([A-Z]{2,6}\d{4,6}[A-Z]?)\b")
WEEKDAY_IDX = {"Mo": 0, "Tu": 1, "We": 2, "Th": 3, "Fr": 4, "Sa": 5, "Su": 6}
DAY_DE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]
DAY_EN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


# ------------------------------------------------------------------ helpers
def log(msg):
    print(msg, file=sys.stderr)


def rows(root):
    return tum.rows(root)


def semester_of(d):
    """TUMonline semester id of a date: Oct-Mar = winter (named after the October year), Apr-Sep = summer."""
    if d.month >= 10:
        return f"{d.year % 100:02d}W"
    if d.month <= 3:
        return f"{(d.year - 1) % 100:02d}W"
    return f"{d.year % 100:02d}S"


def semester_index(sem):
    """Orderable number for a semester id: 26S -> 52, 26W -> 53."""
    return int(sem[:2]) * 2 + (1 if sem[2] == "W" else 0)


def semester_label(sem):
    y = 2000 + int(sem[:2])
    return f"WS {y}/{(y + 1) % 100:02d}" if sem[2] == "W" else f"SoSe {y}"


def to_minutes(hhmm):
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def de_date(iso):
    if not iso:   # exam registration without a date (seminar paper etc.)
        return ""
    y, m, d = iso.split("-")
    return f"{d}.{m}.{y}"


def write_atomic(path, text):
    """Write via temp file + rename, so the Pi web server / Syncthing never see a half-written file."""
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(text)
    os.replace(tmp, path)


def short_room(room):
    """'L.1.11, Seminarraum (1902.01.111)' -> 'L.1.11'; 'Online: Videokonferenz' -> 'Online'."""
    room = (room or "").strip()
    if not room or room.startswith("Ort/Zeit"):
        return ""
    if room.lower().startswith("online"):
        return "Online"
    return room.split(",")[0].split(" (")[0].strip()


def read_template_modules(html):
    """Module list of the template: [(code, title, ects, category), ...]."""
    block = html[html.index("const MODULES = ["):]
    block = block[:block.index("];")]
    return [(c, t, int(e), cat) for c, t, e, cat in
            re.findall(r"\{id:'([^']+)',\s*t:'(.*?)',\s*c:(\d+),\s*cat:'([^']+)'", block)]


def read_template_exams(html):
    block = html[html.index("const EXAMS = {"):]
    block = block[:block.index("\n};")]
    return set(re.findall(r"^\s*'([A-Z0-9]+)':\s*\{text:", block, re.M))


# ------------------------------------------------------------------ TUMonline: personal data
def fetch_grades():
    """All graded exams: code -> {grade, semester, date, credits, title}. Best (latest) attempt per code."""
    out = {}
    for r in rows(tum.api_retry("noten")):
        code = r.get("lv_nummer", "")
        if not code:
            continue
        rec = {"grade": (r.get("uninotenamekurz") or "").strip(), "semester": r.get("lv_semester", ""),
               "date": r.get("datum", ""), "credits": r.get("lv_credits", ""), "title": r.get("lv_titel", "").strip(),
               "mode": r.get("modus", "")}
        if code not in out or rec["date"] > out[code]["date"]:
            out[code] = rec
    return out


def fetch_exam_registrations():
    """Registered exams: code -> {date, semester, title}."""
    out = {}
    for row in tum.api_retry("pruefungenEigene").findall(".//pruefung"):
        r = {c.tag: (c.text or "") for c in row}
        code = r.get("lv_nummer", "")
        if code:
            out[code] = {"date": r.get("datum", ""), "semester": r.get("lv_semester", ""), "title": r.get("lv_titel", "").strip()}
    return out


def fetch_calendar(months_back=2, months_ahead=12):
    """Personal calendar events: list of dicts with code (if any), title, status, kind, start, end, room."""
    events = []
    for e in tum.api_retry("kalender", pMonateVor=str(months_back), pMonateNach=str(months_ahead)).findall(".//event"):
        r = {c.tag: (c.text or "") for c in e}
        title = r.get("title", "").strip()
        desc = r.get("description", "")
        m = MODULE_CODE.search(title)
        try:
            start = datetime.strptime(r["dtstart"][:16], "%Y-%m-%d %H:%M")
            end = datetime.strptime(r["dtend"][:16], "%Y-%m-%d %H:%M")
        except (KeyError, ValueError):
            continue
        events.append({
            "code": m.group(1) if m else None,
            "title": title,
            "status": r.get("status", ""),              # FT = fixed place, WT = planned
            "exam": "Prüfungstermin" in desc or title.endswith(" FA"),
            "fixed": desc.startswith("fix"),
            "start": start, "end": end,
            "room": r.get("location", ""),
            "url": r.get("url", ""),
        })
    return events


def match_title(title, modules):
    """Find the module whose title the calendar entry starts with (for events without a code)."""
    norm = lambda s: re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()
    t = norm(re.sub(r"\s+(FA|VO|UE|SE|PR)$", "", title))
    best = None
    for code, name, _, _ in modules:
        n = norm(name)
        if n and (t.startswith(n) or n.startswith(t)) and (best is None or len(n) > len(best[1])):
            best = (code, n)
    return best[0] if best else None


# ------------------------------------------------------------------ TUMonline: course offer
def load_offer(semester, codes_with_names, max_age_days, refresh):
    path = os.path.join(ROOT, "data", f"offer-{semester}.json")
    if os.path.exists(path) and not refresh:
        with open(path, encoding="utf-8") as fh:
            cached = json.load(fh)
        age = (datetime.now() - datetime.fromisoformat(cached["fetched_at"])).days
        missing = [c for c, _ in codes_with_names if c not in cached["modules"]]
        if age <= max_age_days and not missing:
            log(f"Course offer {semester}: cache from {cached['fetched_at'][:10]} ({len(cached['modules'])} modules)")
            return cached
        log(f"Course offer {semester}: cache is {age} days old, {len(missing)} modules missing -> refreshing")
        refresh = refresh or age > max_age_days   # too old: every module again, not only the missing ones
    else:
        cached = {"modules": {}}
        log(f"Course offer {semester}: fetching {len(codes_with_names)} modules from TUMonline (takes a few minutes)")
    result = dict(cached.get("modules", {})) if not refresh else {}
    for i, (code, name) in enumerate(codes_with_names, 1):
        if code in result and not refresh:
            continue
        try:
            result[code] = tum.module(code, semester, name)
            n = sum(len(p["appointments"]) for p in result[code]["parts"])
            log(f"  [{i}/{len(codes_with_names)}] {code:12} {len(result[code]['parts'])} course(s), {n} dates")
        except tum.TumonlineError as e:
            log(f"  [{i}/{len(codes_with_names)}] {code:12} SKIPPED: {e}")
    data = {"semester": semester, "fetched_at": datetime.now().isoformat(timespec="seconds"), "modules": result}
    os.makedirs(os.path.dirname(path), exist_ok=True)
    write_atomic(path, json.dumps(data, indent=1, ensure_ascii=False))
    return data


def appointments_of(module_entry):
    """All appointments of a module (all its courses), deduplicated: [(date, start, end, room)]."""
    seen = set()
    out = []
    for part in module_entry.get("parts", []):
        for a in part.get("appointments", []):
            key = (a["date"], a["start"], a["end"])
            if key in seen:
                continue
            seen.add(key)
            out.append((a["date"], a["start"], a["end"], a.get("room", "")))
    return sorted(out)


def weekly_slots(appts, min_count=3):
    """Regular weekly slots from a list of appointments: [{d, s, e}] for (weekday, start, end) seen >= min_count."""
    cnt = Counter()
    for d, s, e, _ in appts:
        wd = datetime.strptime(d, "%Y-%m-%d").weekday()
        if wd <= 4:
            cnt[(wd, s, e)] += 1
    slots = [{"d": wd, "s": to_minutes(s), "e": to_minutes(e)} for (wd, s, e), n in cnt.items() if n >= min_count]
    return sorted(slots, key=lambda x: (x["d"], x["s"]))


def block_text(appts):
    """Readable list of single dates for block courses: 'Einzeltermine: Do 22.10. 10:00-14:00, ...'."""
    parts_de, parts_en = [], []
    for d, s, e, _ in appts[:12]:
        dt = datetime.strptime(d, "%Y-%m-%d")
        parts_de.append(f"{DAY_DE[dt.weekday()]} {dt.day:02d}.{dt.month:02d}. {s}-{e}")
        parts_en.append(f"{DAY_EN[dt.weekday()]} {dt.day} {dt.strftime('%b')} {s}-{e}")
    more = f" (+{len(appts) - 12} weitere)" if len(appts) > 12 else ""
    more_en = f" (+{len(appts) - 12} more)" if len(appts) > 12 else ""
    return {"de": "Einzeltermine (TUMonline): " + ", ".join(parts_de) + more,
            "en": "Single dates (TUMonline): " + ", ".join(parts_en) + more_en}


def skal_entry(appts):
    rooms = Counter(short_room(r) for _, _, _, r in appts if short_room(r))
    ort = rooms.most_common(1)[0][0] if rooms else ""   # the most used room, or 'Online'
    return {"ort": ort or "Heilbronn", "dates": [f"{de_date(d)} {s}-{e}" for d, s, e, _ in appts]}


# ------------------------------------------------------------------ main
def main():
    for stream in (sys.stdout, sys.stderr):   # Windows consoles default to cp1252
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    p = argparse.ArgumentParser(description="Build the MMDT dashboard from live TUMonline data")
    p.add_argument("--semester", default=None, help="semester to plan, e.g. 26W (default: the current one)")
    p.add_argument("--out", default=os.path.join("data", "dashboard.html"))
    p.add_argument("--template", default=TEMPLATE)
    p.add_argument("--refresh-offer", action="store_true", help="re-fetch the whole course offer")
    p.add_argument("--offer-max-age", type=int, default=7, help="days before the cached course offer is refreshed")
    p.add_argument("--start-semester", default=None, help="your first semester, e.g. 26S (default: derived from your grades)")
    p.add_argument("--no-offer", action="store_true", help="skip the course offer (personal data + handbook only)")
    a = p.parse_args()

    today = date.today()
    semester = a.semester or semester_of(today)
    with open(a.template, encoding="utf-8") as fh:
        html = fh.read()
    modules = read_template_modules(html)
    codes = {c for c, _, _, _ in modules}
    template_exams = read_template_exams(html)
    log(f"Template: {len(modules)} modules, {len(template_exams)} exam descriptions")

    # ---- 1. personal data
    grades = fetch_grades()
    exams = fetch_exam_registrations()
    cal = fetch_calendar()
    log(f"TUMonline: {len(grades)} graded exams, {len(exams)} exam registrations, {len(cal)} calendar events")

    # first semester of this program = earliest semester with a graded/registered exam for a module of the template
    sems = [r["semester"] for c, r in list(grades.items()) + list(exams.items()) if c in codes and r.get("semester")]
    start_sem = a.start_semester or (min(sems, key=semester_index) if sems else semester)
    sem_no = lambda s: max(1, min(4, semester_index(s) - semester_index(start_sem) + 1))
    cursem = sem_no(semester)
    log(f"First semester {start_sem} ({semester_label(start_sem)}), {semester} is semester {cursem}")

    picked, cs, exam_dates = {}, {}, {}
    for code, r in grades.items():
        if code not in codes:
            continue
        g = r["grade"].replace(",", ".")
        try:
            passed = float(g) <= 4.0
        except ValueError:
            passed = g.upper() in ("B", "BE")
        if not passed:
            continue
        picked[code] = str(sem_no(r["semester"]))
        cs[code] = {"s": "bestanden", "g": r["grade"] if re.match(r"^\d", r["grade"]) else ""}
    for code, r in exams.items():
        if code in codes and code not in cs:
            picked[code] = str(sem_no(r["semester"]))
            cs[code] = {"s": "in_progress", "g": ""}
            if r["date"]:
                exam_dates[code] = r["date"]

    # calendar: fixed-place courses of the semester with their real dates/rooms
    cal_dates = defaultdict(list)
    for e in cal:
        code = e["code"] or match_title(e["title"], modules)
        if not code or code not in codes:
            continue
        if e["exam"]:
            exam_dates.setdefault(code, e["start"].strftime("%Y-%m-%d"))
            continue
        if not e["fixed"]:
            continue
        cal_dates[code].append((e["start"].strftime("%Y-%m-%d"), e["start"].strftime("%H:%M"), e["end"].strftime("%H:%M"), e["room"]))
    for code, appts in cal_dates.items():
        sem = semester_of(datetime.strptime(min(appts)[0], "%Y-%m-%d").date())
        picked.setdefault(code, str(sem_no(sem)))
        if code not in cs:
            cs[code] = {"s": "fixplatz", "g": ""}
    # Moodle: courses of this semester you are enrolled in but have no fixed place for -> wait list.
    # Written by the Moodle sync on the laptop (data/moodle-kurse.json, synced to the Pi; override with MOODLE_KURSE).
    # A fixed place from TUMonline replaces it automatically; a status you set by hand in the dashboard is kept.
    moodle_path = os.environ.get("MOODLE_KURSE") or os.path.join(ROOT, "data", "moodle-kurse.json")
    moodle_wait = []
    try:
        with open(moodle_path, encoding="utf-8") as fh:
            mk = json.load(fh)
    except (OSError, ValueError):
        mk = None
    if mk and mk.get("semester") == semester:
        for k in mk.get("kurse", []):
            for code in re.findall(r"\(([A-Z]{2,}[A-Z0-9]*\d{3,})\)", k.get("name", "")):
                if code in codes and code not in cs:
                    picked[code] = str(cursem)
                    cs[code] = {"s": "warteliste", "g": "", "src": "moodle"}
                    moodle_wait.append(code)
        log(f"Moodle ({mk.get('stand', '?')[:16]}): {len(mk.get('kurse', []))} courses, wait list: {', '.join(moodle_wait) or '-'}")
    else:
        log(f"Moodle course list not found or for another semester: {moodle_path}")
    log(f"Personal: {sum(1 for v in cs.values() if v['s']=='bestanden')} passed, "
        f"{sum(1 for v in cs.values() if v['s']=='in_progress')} exam pending, {len(cal_dates)} fixed-place courses")

    # ---- 2. course offer
    ws, schedule, blocks, skal = [], {}, {}, {}
    offer_stand = ""
    if not a.no_offer:
        real = [(c, t) for c, t, _, _ in modules if MODULE_CODE.fullmatch(c)]   # skips placeholders like APS / THESIS
        offer = load_offer(semester, real, a.offer_max_age, a.refresh_offer)
        offer_stand = offer["fetched_at"][:10]
        for code, entry in offer["modules"].items():
            appts = appointments_of(entry)
            if not appts and not entry.get("parts"):
                continue
            ws.append(code)
            if not appts:
                continue
            slots = weekly_slots(appts)
            if slots:
                for s in slots:
                    s["src"] = "TUMonline"
                schedule[code] = slots
            else:
                blocks[code] = block_text(appts)
            skal[code] = skal_entry(appts)
    # your own calendar beats the generic offer (it holds the group you are actually in)
    for code, appts in cal_dates.items():
        appts = sorted(set(appts))
        slots = weekly_slots(appts)
        if slots:
            for s in slots:
                s["src"] = "TUMonline"
            schedule[code] = slots
            blocks.pop(code, None)
        elif code not in schedule:
            blocks[code] = block_text(appts)
        skal[code] = skal_entry(appts)
        if code not in ws:
            ws.append(code)

    # ---- 3. exam formats from the handbook
    hb = handbook.load(os.path.join(ROOT, "data", "mhb", "processed"))
    hb_exams = {c: v for c, v in hb["exams"].items() if c in codes and c not in template_exams}
    missing_exam = sorted(c for c in ws if c not in template_exams and c not in hb["exams"])
    log(f"Handbook {hb['stand'] or '-'}: {len(hb['exams'])} exam descriptions, {len(hb_exams)} new for the template; "
        f"{len(missing_exam)} offered modules without any exam description")

    # ---- 4. write
    stand = today.strftime("%d.%m.%Y")
    live = {
        "built": datetime.now().isoformat(timespec="seconds"),
        "semester": semester, "semesterLabel": semester_label(semester), "stand": stand, "offerStand": offer_stand,
        "handbookStand": hb["stand"],
        "ws": sorted(ws), "schedule": schedule, "blocks": blocks, "skal": skal, "exams": hb_exams,
        "examDates": {c: de_date(d) for c, d in exam_dates.items()},
        "missingExam": missing_exam,
        "me": {"cursem": str(cursem), "startSemester": start_sem, "picked": picked, "cs": cs},
    }
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "live_patch.js"), encoding="utf-8") as fh:
        patch = fh.read()
    block = ("\n// ==== TUM_LIVE: generated by scripts/build_dashboard.py, do not edit (built " + live["built"] + ") ====\n"
             "const TUM_LIVE = " + json.dumps(live, ensure_ascii=False, separators=(",", ":")) + ";\n" + patch + "\n")
    marker = "document.addEventListener('DOMContentLoaded', init);"
    if marker not in html:
        sys.exit("template.html: init marker not found, template changed?")
    out_html = html.replace(marker, marker + block, 1)
    out_html = out_html.replace("<!-- MMDT Study Dashboard · Blanko-Vorlage",
                                f"<!-- MMDT Study Dashboard · built from TUMonline {stand} by mmdt-dashboard", 1)
    out_path = a.out if os.path.isabs(a.out) else os.path.join(ROOT, a.out)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    write_atomic(out_path, out_html)

    # ---- report
    name_of = {c: t for c, t, _, _ in modules}
    lines = [f"# Dashboard build {live['built']}", "",
             f"- Semester: {semester_label(semester)} (semester {cursem} of your program, started {semester_label(start_sem)})",
             f"- Course offer: {len(ws)} modules with a course this semester (TUMonline {offer_stand or 'skipped'})",
             f"- Weekly slots: {len(schedule)}, block courses: {len(blocks)}, modules with dates: {len(skal)}",
             f"- Handbook: {hb['stand'] or 'not found'}, {len(hb_exams)} exam descriptions added", "",
             "## Your courses (from TUMonline)", ""]
    for code in sorted(cs, key=lambda c: (picked.get(c, "9"), c)):
        s = cs[code]
        extra = f" {s['g']}" if s["g"] else ""
        if code in exam_dates and s["s"] != "bestanden":
            extra += f" (exam {de_date(exam_dates[code])})"
        if s.get("src") == "moodle":
            extra += " (Moodle, no fixed place in TUMonline)"
        lines.append(f"- Sem {picked.get(code, '?')} · {code} {name_of.get(code, '')}: {s['s']}{extra}")
    lines += ["", "## Exam format missing (not in template, not in handbook)", ""]
    lines += [f"- {c} {name_of.get(c, '')}" for c in missing_exam] or ["- none"]
    report = "\n".join(lines) + "\n"
    with open(os.path.join(ROOT, "data", "build-report.md"), "w", encoding="utf-8") as fh:
        fh.write(report)
    print(report)
    log(f"Written: {out_path}")


if __name__ == "__main__":
    try:
        main()
    except (tum.TumonlineError, OSError) as e:   # OSError = URLError/timeout after api_retry gave up
        sys.exit(f"{type(e).__name__}: {e}")
