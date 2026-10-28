# mmdt-dashboard

Your MMDT study dashboard, filled automatically from TUMonline. Grades, passed modules, registered
exams, the courses you have a place in (with every date and room), and the course offer of the
semester come straight from TUMonline through your personal API token. Nothing to type in by hand.

Built for the M.Sc. Management and Digital Technology (TUM Campus Heilbronn). The dashboard page
itself (`template.html`) is the MMDT Study Dashboard; this repo adds the data link. Sister project
of [tum-coursepilot](https://github.com/Lioserious/tum-coursepilot), which plans your semester
with Claude; both use the same token.

> **Unofficial student project.** Not affiliated with or endorsed by TUM. "TUM" and "TUMonline"
> name the university and its systems only. For binding information, always check TUMonline.

## What you get

`data/dashboard.html`, one file, open it in any browser. On the phone it is a compact app with a bottom bar
(add it to the home screen). It shows:

| In the dashboard | Comes from |
|---|---|
| Passed modules with grades, ECTS progress per category | TUMonline grades (`noten`) |
| Exams you are registered for, with dates, status "in progress" | TUMonline exam registrations |
| Courses you have a fixed place in, status "Fixplatz", weekly plan, calendar with rooms | Your personal TUMonline calendar |
| Which modules run this semester, their weekly slots and single dates | TUMonline course search |
| Exam format of every module | TUM module handbook (downloaded automatically) + curated texts in the template |

Everything you still set by hand in the dashboard (wait-list status, notes, planned modules for
later semesters, deadlines you add) stays; TUMonline facts only overwrite what they know better.
The thesis is planned for semester 4 of your program until you pick another semester or date yourself.

## Setup (10 minutes)

You need Python 3.9+ (`py --version` on Windows, `python3 --version` elsewhere).

1. **Token.** Follow [tum-coursepilot, step 1](https://github.com/Lioserious/tum-coursepilot/blob/main/docs/1-get-your-token.md)
   to create your TUMonline token. When TUMonline asks for the token rights, enable
   **Lehrveranstaltungen, Noten, Prüfungen, Kalender** (courses, grades, exams, calendar).
   Copy `.env.example` to `.env` and paste the token. If you already use tum-coursepilot in a
   folder next to this one, its `.env` is picked up automatically.
2. **PDF reader for the handbook:** `pip install pymupdf` (or `pypdf`).
3. **Build:**
   ```bash
   py scripts/build_dashboard.py          # Windows
   python3 scripts/build_dashboard.py     # macOS / Linux / Raspberry Pi
   ```
   The first run fetches the course offer for all modules (a few minutes); later runs reuse it for
   7 days (`--refresh-offer` forces a new fetch). Open `data/dashboard.html`.

A short report of what was imported, and which modules still lack an exam description, is printed
and saved to `data/build-report.md`.

## Keep it updated automatically

The build only needs the token, no login, so it can run on a schedule:

- **Windows:** `scripts\schedule-windows.ps1` registers a daily task (06:00) in Task Scheduler.
- **Raspberry Pi / Linux / macOS:** create a virtualenv once and add a cron line:
  ```bash
  cd /path/to/mmdt-dashboard && python3 -m venv venv && ./venv/bin/pip install pymupdf
  crontab -e   # then add:
  0 6 * * * cd /path/to/mmdt-dashboard && flock -n /tmp/mmdt_dashboard.lock ./venv/bin/python scripts/build_dashboard.py >> data/build.log 2>&1
  ```
  `flock` makes sure two builds never run at the same time.

To open the dashboard on your phone, serve `data/` inside your home network:

```bash
python3 scripts/serve.py            # http://<pi>:8080/dashboard.html
```

`serve.py` is a plain static server plus the two small endpoints the page uses when it is opened over
http instead of as a file: `/api/mmdt-state` keeps everything you set by hand (status, notes, to-dos,
plans) in `data/mmdt-state.json`, so phone and laptop show the same thing (newest change wins), and
`/api/kalender` serves your Google Calendar fresh (every 10 minutes, see below) instead of the copy baked
in at build time (`/api/kalender` needs the same two packages as the calendar option below). Opened as a
file, the dashboard still works and says so at the top, but your entries stay in that one browser. The same
is true, silently, for a server without these endpoints (`python3 -m http.server`, nginx, ...). Any other
server works as long as it answers `GET`/`PUT /api/mmdt-state` with `{"ts": <ms>, "state": {...}}`.

**Do not publish the generated file**: it contains your grades. Keep the server in your home network
(or put authentication in front of it).

If the repo folder is mirrored between PC and Pi (for example with Syncthing), the Pi can build
in place and the finished dashboard shows up on the PC by itself. Exclude `venv/` from the sync.

## Google Calendar (optional)

With your calendar the Today view shows what is next, the weekly plan shows your real appointments, and a
bar at the top shows where you are in the semester: light blue at the first day of lectures, dark blue at the
last deadline, with a red dot for every graded deadline, presentation or exam. Tap a dot to see what it is.

1. Google Calendar (on a computer) -> Settings -> your calendar -> **Integrate calendar** ->
   **Secret address in iCal format**. Copy it.
2. Put it into `.env` as `GOOGLE_CAL_ICS_URL=...`. The address is read-only, but whoever knows it can read your
   calendar: keep it in `.env` and never post it. You can reset it in the same place.
3. `pip install icalendar recurring-ical-events`, then build as usual.

Red dots come from the **title** of an appointment: `DEADLINE ...`, `Abgabe ...`, or words like presentation, exam,
assignment, submission. Organisational dates (registration, kick-off, team up) are skipped. Both word lists are at
the top of `scripts/gcal.py`. Nothing is ever written to your calendar. Without the address the dashboard works
as before, just without calendar and bar dots. The first day of the semester is `SEM_START` in `template.html`
(12.10.2026 for the winter semester 2026/27).

## Cockpit (optional)

If you run a personal task Cockpit with the Supabase Edge Function `mmdt`, the dashboard can read your uni
tasks, uni deadlines and Google Calendar live from it. Open **Settings** (gear icon) -> **Cockpit**, paste your
device token and keep (or change) the function address, then tap **Test connection**. The status line shows the
time of the last update, open tasks and deadlines, or "Token rejected" in red.

With a token the To-dos on the Today view come from the Cockpit: one card per course of the current semester,
plus "Uni general" for tasks without a course. Ticking a task, reopening it or adding one is sent to the Cockpit
right away; a date at the start of a new to-do (`05.11. Read paper`) becomes its due date. "Coming up" also shows
Cockpit deadlines, and open submissions, exams and presentations get a red dot in the semester bar. Your local
to-dos stay saved and come back when you remove the token; weekend to-dos stay local. Offline, the last good
answer is shown with its time. The token is stored only in this browser: it is not part of the JSON export and
not part of the device sync. Without a token everything works exactly as before.

## Options

```
py scripts/build_dashboard.py --semester 27S        # plan another semester
py scripts/build_dashboard.py --start-semester 26S  # your first semester (default: derived from your grades)
py scripts/build_dashboard.py --refresh-offer       # re-fetch all courses now
py scripts/build_dashboard.py --no-offer            # personal data + handbook only (fast)
py scripts/handbook.py MGTHN0094                    # show the handbook exam text of one module
py scripts/tumonline.py status                      # token check
```

## Files

| File | What it does |
|---|---|
| `template.html` | The MMDT Study Dashboard (blank template, no personal data) |
| `scripts/build_dashboard.py` | Fetches TUMonline + handbook, writes `data/dashboard.html` and `data/build-report.md` |
| `scripts/live_patch.js` | The small script injected into the dashboard that applies the live data |
| `scripts/tumonline.py` | TUMonline API client (from tum-coursepilot, MIT), extended with grades/calendar fallbacks |
| `scripts/gcal.py` | Optional: reads your Google Calendar through its secret iCal address (read-only) |
| `scripts/serve.py` | Optional: home-network server for `data/` with device sync (`/api/mmdt-state`) and live calendar (`/api/kalender`) |
| `scripts/handbook.py` | Downloads the module handbook PDFs and extracts exam formats |
| `data/codes.txt` | Module codes and names of the MMDT curriculum (taken from the template) |
| `data/` (rest) | Your token-fetched data and the generated dashboard; ignored by git |

## Another program than MMDT?

The template is MMDT-specific (modules, categories, ECTS rules). The data link is generic:
`scripts/tumonline.py` and `scripts/handbook.py` work for any TUM program. Point
`HANDBOOK_URL` in `scripts/handbook.py` to your program's handbook listing in TUMonline and adapt
the module list in the template.

## Privacy

- The token is a personal credential. It lives in `.env`, which git ignores. Never share or commit it.
- The generated dashboard contains your grades. It is written to `data/`, which git ignores. Keep it private.
- Nothing is sent anywhere except to `campus.tum.de` (and `calendar.google.com` if you use the calendar option).
- The secret calendar address is a credential like the token: `.env` only, never in the repo. The generated dashboard contains your appointments as well, so keep `data/` private.
