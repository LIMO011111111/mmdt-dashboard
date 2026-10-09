#!/usr/bin/env python3
"""Small TUMonline client for course planning. Python standard library only.

Usage:
    python scripts/tumonline.py status
    python scripts/tumonline.py search "Deep Reinforcement Learning" --semester 26W --campus Heilbronn
    python scripts/tumonline.py module WIHN0033 --semester 26W
    python scripts/tumonline.py course 950945134
    python scripts/tumonline.py module MGTHN0189 --name "Marketing Research" --semester 26W
    python scripts/tumonline.py fetch data/candidates.txt --semester 26W --out data/modules.json

Your token is read from .env (TUMONLINE_TOKEN=...) or the environment and is never printed.
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from collections import Counter
from datetime import datetime

BASE = "https://campus.tum.de/tumonline/wbservicesbasic"
WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]
MODULE_CODE = re.compile(r"\b[A-Z]{2,6}\d{4,6}[A-Z]?\b")


def load_token():
    # .env lives in the repo root, one level above scripts/
    # .env in this repo first, then a tum-coursepilot checkout next to it (shared token)
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for env_path in (os.path.join(root, ".env"), os.path.join(os.path.dirname(root), "tum-coursepilot", ".env")):
        if not os.path.exists(env_path):
            continue
        with open(env_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("TUMONLINE_TOKEN="):
                    token = line.split("=", 1)[1].strip().strip("\"'")
                    if token:
                        return token
    token = os.environ.get("TUMONLINE_TOKEN")
    if token:
        return token
    sys.exit("No token found. Put TUMONLINE_TOKEN=... into .env (see docs/1-get-your-token.md).")


TOKEN = None
DETAILS_DOWN = False   # set when TUMonline refuses veranstaltungenDetails ("Auskunft derzeit nicht moeglich")


def api(endpoint, **params):
    global TOKEN
    TOKEN = TOKEN or load_token()
    params["pToken"] = TOKEN
    url = f"{BASE}.{endpoint}?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=30) as resp:
        body = resp.read().decode("utf-8")
    root = ET.fromstring(body)
    if root.tag == "error":
        message = (root.findtext("message") or "unknown error").replace(TOKEN, "***")
        raise TumonlineError(f"TUMonline error: {message}  (see docs/1-get-your-token.md, section Troubleshooting)")
    return root


class TumonlineError(Exception):
    pass


def api_retry(endpoint, tries=4, wait=5, **params):
    """TUMonline answers 'Auskunft derzeit nicht moeglich' now and then; retry a few times before giving up."""
    for i in range(tries):
        try:
            return api(endpoint, **params)
        except (TumonlineError, OSError) as e:
            if i == tries - 1:
                raise
            time.sleep(wait * (i + 1))


def rows(root):
    return [{c.tag: c.text for c in row if c.text} for row in root.findall(".//row")]


def search(query, semester):
    return rows(api_retry("veranstaltungenSuche", pSuche=query, pSemester=semester))


def details(course_id):
    found = rows(api("veranstaltungenDetails", pLVNr=course_id))
    return found[0] if found else {}


def dates(course_id):
    out = []
    for d in rows(api_retry("veranstaltungenTermine", pLVNr=course_id)):
        begin, end = d.get("beginn_datum_zeitpunkt"), d.get("ende_datum_zeitpunkt")
        if not (begin and end):
            continue
        b = datetime.strptime(begin, "%Y-%m-%d %H:%M")
        e = datetime.strptime(end, "%Y-%m-%d %H:%M")
        out.append({
            "date": b.strftime("%Y-%m-%d"),
            "weekday": WEEKDAYS[b.weekday()],
            "start": b.strftime("%H:%M"),
            "end": e.strftime("%H:%M"),
            "room": d.get("ort", ""),
        })
    return sorted(out, key=lambda a: (a["date"], a["start"]))


def course(course_id, hit=None):
    """Everything a planner needs about one TUMonline course (lecture, exercise, seminar...).

    `hit` is the search row for this course. When TUMonline refuses the details request
    (it does that for hours at a time), the search row fills in title, type, chair and lecturers.
    """
    global DETAILS_DOWN
    try:
        if DETAILS_DOWN and hit is not None:
            raise TumonlineError("details skipped")
        d = details(course_id)
    except TumonlineError:
        if hit is None:
            raise
        DETAILS_DOWN = True   # do not wait for the details endpoint again in this run
        d = {"stp_sp_titel": hit.get("stp_sp_titel", ""), "stp_lv_art_name": hit.get("stp_lv_art_name", ""),
             "stp_sp_sst": hit.get("stp_sp_sst", ""), "vortragende_mitwirkende": hit.get("vortragende_mitwirkende", ""),
             "org_name_betreut": hit.get("org_name_betreut", ""), "details_unavailable": True}
    appts = dates(course_id)
    slots = Counter(f'{a["weekday"]} {a["start"]}-{a["end"]}' for a in appts)
    return {
        "id": course_id,
        "title": d.get("stp_sp_titel", ""),
        "type": d.get("stp_lv_art_name", ""),
        "sws": d.get("stp_sp_sst", ""),
        "lecturers": d.get("vortragende_mitwirkende", ""),
        "chair": d.get("org_name_betreut", ""),
        "exam": d.get("pruefmodus", ""),
        "content": d.get("lehrinhalt", ""),
        "prerequisites": d.get("voraussetzung_lv", ""),
        "registration_note": d.get("anmeld_lv", ""),
        "note": d.get("anmerkung", ""),
        "first_date": d.get("ersttermin", ""),
        "regular_slots": [s for s, _ in slots.most_common(3)],
        "appointments": appts,
        "details_unavailable": bool(d.get("details_unavailable")),
    }


def module(code, semester, name=None):
    """All courses of one module code in a semester.

    TUMonline search is fuzzy: searching a name also returns courses from other campuses.
    We keep only entries that carry the exact module code in their title, and drop
    placeholder entries ("Fach") that have no dates. Some courses omit the code in their
    title. Then we fall back to the module name and keep only titles without any other
    module code, marked "matched_by": "name" so a human (or Claude) double-checks them.
    """
    def collect(hits, keep):
        parts = []
        for cid, r in hits.items():
            if not keep(r.get("stp_sp_titel", "")):
                continue
            c = course(cid, hit=r)
            time.sleep(0.2)
            if c["appointments"] or r.get("stp_lv_art_kurz") != "FA":
                parts.append(c)
        return parts

    hits = {r["stp_sp_nr"]: r for r in search(code, semester) if r.get("stp_sp_nr")}
    parts = collect(hits, lambda title: code in MODULE_CODE.findall(title))
    matched_by = "code"
    if not parts and name:
        hits = {r["stp_sp_nr"]: r for r in search(name, semester) if r.get("stp_sp_nr")}
        parts = collect(hits, lambda title: name.lower() in title.lower() and not MODULE_CODE.findall(title))
        matched_by = "name"
    return {"code": code, "name": name, "semester": semester, "matched_by": matched_by, "parts": parts}


def main():
    p = argparse.ArgumentParser(description="TUMonline helper for course planning")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status", help="check that your token works")
    s = sub.add_parser("search", help="free-text course search")
    s.add_argument("query")
    s.add_argument("--semester", default="26W", help="e.g. 26W, 27S")
    s.add_argument("--campus", help="list courses whose chair names this campus first, marked with *")
    m = sub.add_parser("module", help="all courses of a module code, with dates and exam mode")
    m.add_argument("code")
    m.add_argument("--name", help="module name, used when no course carries the code in its title")
    m.add_argument("--semester", default="26W")
    c = sub.add_parser("course", help="one course by TUMonline id")
    c.add_argument("id")
    f = sub.add_parser("fetch", help='fetch many modules into a JSON file, one "CODE  # Module name" per line')
    f.add_argument("codes_file")
    f.add_argument("--semester", default="26W")
    f.add_argument("--out", default="data/modules.json")
    a = p.parse_args()

    if a.cmd == "status":
        confirmed = api("isTokenConfirmed").text
        print("Token works." if confirmed == "true" else "Token exists but is not activated yet.")
    elif a.cmd == "search":
        hits = search(a.query, a.semester)
        if a.campus:
            # TUMonline has no campus field. The campus name shows up in some chair names only,
            # so we sort matches first instead of dropping the rest.
            key = a.campus.lower()
            match = lambda r: key in (r.get("org_name_betreut", "") + r.get("stp_sp_titel", "")).lower()
            hits = sorted(hits, key=lambda r: not match(r))
        for r in hits:
            mark = "*" if a.campus and match(r) else " "
            print(f'{mark} {r.get("stp_sp_nr")}  {r.get("stp_lv_art_kurz", ""):3}  {r.get("stp_sp_titel", "")}'
                  f'  | {r.get("org_name_betreut", "")}')
    elif a.cmd == "module":
        print(json.dumps(module(a.code, a.semester, a.name), indent=2, ensure_ascii=False))
    elif a.cmd == "course":
        print(json.dumps(course(a.id), indent=2, ensure_ascii=False))
    elif a.cmd == "fetch":
        entries = []
        with open(a.codes_file, encoding="utf-8") as fh:
            for line in fh:
                code, _, name = line.partition("#")
                if code.strip():
                    entries.append((code.strip(), name.strip() or None))
        result = {}
        for code, name in entries:
            try:
                result[code] = module(code, a.semester, name)
            except TumonlineError as e:
                print(f"{code:12} SKIPPED: {e}", file=sys.stderr)
                continue
            n = sum(len(x["appointments"]) for x in result[code]["parts"])
            flag = "  (matched by name, check it)" if result[code]["matched_by"] == "name" and n else ""
            print(f"{code:12} {len(result[code]['parts'])} course(s), {n} dates{flag}", file=sys.stderr)
        os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
        with open(a.out, "w", encoding="utf-8") as fh:
            json.dump({"semester": a.semester, "fetched_at": datetime.now().isoformat(timespec="seconds"),
                       "modules": result}, fh, indent=2, ensure_ascii=False)
        print(f"Saved {len(result)} modules to {a.out}", file=sys.stderr)


if __name__ == "__main__":
    try:
        main()
    except TumonlineError as e:
        sys.exit(str(e))
