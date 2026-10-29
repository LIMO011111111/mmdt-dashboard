# Dashboard tests

Browser tests (Playwright / Chromium) for the single-file dashboard `template.html`.
They run against a **preview build** made from `template.html` + `scripts/live_patch.js` and
**invented sample data** (`make_preview.py`): no TUMonline token, no Google account, no network,
no files from `data/`.

> **Privacy rule:** this repository is public. Everything under `tests/` must stay generic
> (course codes from the public module handbook, placeholder events such as "Team-Meeting" or
> "Call Kunde", made-up grades, the dummy token `geheim-123`). Do not paste real appointments,
> names, e-mail addresses, tokens or project URLs into the tests or the mock.

## Run locally

Requirements: Git, Python 3.9+, Node 18+ (CI uses Python 3.12 and Node 20), Chromium for Playwright.

```bash
cd tests && npm install && npx playwright install chromium && cd ..   # once
tests/run.sh                  # all suites, base = HEAD
tests/run.sh 95b7a4b          # base = an older commit (see "Base ref" below)
tests/run.sh --only=theme,ck  # only some suites (theme, ck, ceo, glass, bugs, py)
```

If Playwright is already installed globally (`require('playwright')` works), the install step is not needed.

Exit code: `0` all green, `1` at least one test failed or a suite crashed, `2` a prerequisite is missing.
Output goes to `tests/out/` (git-ignored): `logs/<suite>.log`, `shots/<suite>/*.png`, `build/*.html`.

Typical runtime: about 8 minutes on a 2-core machine, most of it the `glass` suite (about 5 min).

### What `run.sh` does

1. Writes the base stand (`git show <REF>:template.html` and `scripts/live_patch.js`) to `tests/out/build/base-root/`.
2. Builds the preview pages with **one shared timestamp** (`make_preview.py --now ...`), so base and new
   are byte-identical wherever the code is identical (no minute rollover between the two builds).
   The time zone is fixed to `Europe/Berlin` (the CI machine runs in UTC).
3. Starts the Cockpit mock server(s) on free ports and always stops them again (`trap`).
4. Runs the suites one after another and prints a summary table.

### Base ref

Some tests compare the working tree ("new") with an earlier stand ("base"), e.g. "Classic style is unchanged by the
Glass style". `REF` selects that earlier stand (default `HEAD`; in CI the working tree equals `HEAD`, so the comparison
is trivially equal and only the absolute checks matter). To check a change you have not committed yet, `HEAD` is the
right base. To check a whole series of commits, pass the commit before the series.

Two build variants keep unrelated features from showing up as differences:

| Variant | Meaning | Used for |
|---|---|---|
| `noceo` | CEO Strategy Series (`MGTHN0130`) not selected | `glass` (base vs new) |
| `nodates` | selected, but without individual dates (no session dots) | `ck` (base vs new) |
| (none) | full data | `theme`, `ceo` |

## Suites

| Suite | File | Builds | What it checks |
|---|---|---|---|
| `theme` | `theme-test.js` | new | Light / Dark / Automatic: system setting x user setting matrix, colours of body and cards, inverted TUM logo in dark mode, note colour, `color-scheme`, `data-theme` and `theme-color` meta tags; switching without reload, persistence, no overflow at 390 px, no console errors. |
| `ck` | `ck-test.js` | base + new (`nodates`) | Cockpit mode against the mock (`cockpit-mock.js`): without token everything is identical to base and no request is sent; with token tasks, deadlines and calendar are shown, status line, offline cache, 401 handling, URL validation (https only, localhost allowed), tokens never stored in the exported state, deadline upload (idempotent, switch off, never past or deselected courses), all-day deadlines in `Europe/Berlin` even if the browser runs elsewhere, phone light/dark. |
| `ceo` | `ceo-test.js` | new | CEO Strategy Series: every session counts as an exam. Red dots in the semester bar (one per upcoming day), popover text (DE / EN / IT), "Demnächst" list, push of the sessions to the mock (count, fields, marker, no second push after reload, switch off, course deselected), de-duplication against ICS deadlines, calendar entries and Cockpit tasks, done state, two tabs (Web Locks and lease fallback), no overflow, Classic + Glass screenshots. |
| `glass` | `glass-test.js` | base + new (`noceo`) | Style switch Classic / Glass: Classic is unchanged (computed styles of every visible element and screenshots against base), Glass in light / dark / auto x phone / desktop, blur layers, WCAG AA contrast of labels on glass, bars and sticky filter, 320 px without overflow, switching, persistence, language, other tab, fallbacks (reduced transparency, no `backdrop-filter`, reduced motion), screenshots. v22: before comparing Classic with base, two deliberate changes are taken out on both pages (`neutralizeV22`): the phone rule "input fields at least 16px" (iOS zoom) and the new German/Italian text for "no management specialization". Everything else must still be identical. |
| `bugs` | `bugs-test.js` | new + variants `crash`, `sose`, `xss`, base (`noceo`, as an "old client") | v22 bug fixes: invalid dates (`18:00-00:00` = until midnight, end before start / broken format skipped with a warning, one failing view or calendar does not stop the app), device sync against the real `serve.py` with two browser contexts (stale tab, delete vs. parallel add, per-entry newest wins, settings), merge details with one `serve.py` per case (note text merged line by line, conflicting lines kept with a `--- Konflikt` marker; to-dos and course status merged field by field; module choice newer wins; device clock 10 min ahead corrected via the server `Date` header; first sync without common state keeps local entries; two tabs sharing one localStorage; v22 re-check: conflict marks only the disputed lines, notes are never cut (warning from 100,000 characters), no idle PUTs with a wrong clock, lost PUT reply, keys removed elsewhere stay removed, settings count as own data, course status survives deselection elsewhere, empty/unreadable server answers 500 or is ignored), raw protocol (`base` / `409`, non-numeric `ts` = 400), old client on the new server, new client on an old server, the Cloudflare Pages Function with a mock KV (only if `MMDT_PAGES_FN` points to `functions/api/mmdt-state.js`, otherwise `SKIP`), stored XSS over all views / import / sync pull and `</script>` inside build data (no break-out of the embedded script) (no script runs, the Cockpit token does not leak, lengths and types limited), semester from TUMonline or the date (WS 26/27 today unchanged except the week view starts in the current week, SoSe 2027 at 10.05.2027, fallback rule without a build), own semester choice survives the build, phone and touch devices (iPad, iPhone landscape) input fields >= 16px in both styles without overflow (screenshots `ios16-*`), import redraws everything (note, own course, settings), labels and keyboard for the module list, long words at 320 px, specialization text per language. |
| `py` | `py-test.py` | – | Python scripts without network: TUMonline maintenance page / timeout / HTTP errors become `TumonlineError` (one retry on timeout and 5xx), the course offer continues after a broken module and writes its cache while running (atomically), the build still runs with a broken offer and handbook, dates over midnight end at 24:00, a broken handbook PDF is deleted and downloaded again (via `.tmp`), build data is embedded script-safe (`</script>`, U+2028), the offer cache survives a TUMonline outage (also with `--refresh-offer`), an interrupted response (`IncompleteRead`) is retried once. |

Each suite prints `OK`/`FAIL` per check and ends with `N FAIL / M`; `run.sh` reads that line (and the exit code).
The `FAIL` lines are repeated in the summary, the full log is `tests/out/logs/<suite>.log`.

## Files

| File | Purpose |
|---|---|
| `run.sh` | Runner (builds, mocks, suites, summary, exit code) |
| `make_preview.py` | Preview builder with the invented data; `--variant noceo\|nodates\|crash\|sose\|xss`, `--now <ISO>` |
| `cockpit-mock.js` | Mock of the Supabase Edge Function `mmdt` (`node cockpit-mock.js [port] [token]`), with test hooks `/__log`, `/__fail`, `/__delay`, `/__gets` |
| `theme-test.js`, `ck-test.js`, `ceo-test.js`, `glass-test.js`, `bugs-test.js`, `py-test.py` | The suites; each can also be run by hand, see the first lines of the file |
| `shots.js` | Screenshot helper (not part of `run.sh`): `node tests/shots.js <preview.html> <outDir> [prefix]`, env `VIEWS=heute,kurse`, `CONFIGS=phone,desktop` |
| `package.json`, `package-lock.json` | Only pins Playwright (`1.63.0`) for CI |

To run a single suite by hand, build the previews first (`python3 tests/make_preview.py . /tmp/new.html`) and, for
`ck` / `ceo`, start the mock(s) on the ports you pass in (see the header of the test file).

## CI

`.github/workflows/ci.yml` runs `tests/run.sh` on every push and pull request (all branches) on Ubuntu with
Python 3.12 and Node 20; Chromium comes from `npx playwright install --with-deps chromium`.
No secrets are needed. Only on failure the logs and screenshots (`tests/out/logs`, `tests/out/shots`, invented data only)
are uploaded as an artifact for 3 days. Builds and `data/` are never uploaded.

## When a test is red

- Read the `FAIL` line first; the text after `—` shows the expected / actual value.
- A `glass` or `ck` failure in a "unchanged" check after a deliberate change to the Classic look means the base moved:
  run with the commit before your change (`tests/run.sh <commit>`).
- Screenshots of the failing run are in `tests/out/shots/<suite>/`.
- Do not "fix" a test by putting real data into the preview. Change the expectation or the invented data instead.
