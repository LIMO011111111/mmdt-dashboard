#!/usr/bin/env bash
# Testlauf fuer das Dashboard (Playwright/Chromium, nur erfundene Daten, kein Netz, keine Tokens).
#
#   tests/run.sh [REF] [--only=theme,glass,ck,ceo]
#
#   REF     Git-Stand fuer die "Klassisch unveraendert"-Vergleiche (Basis). Default: HEAD.
#           Beispiel: tests/run.sh 95b7a4b   (Stand vor dem Glas-Stil)
#   --only  nur diese Suites laufen lassen (Komma-getrennt)
#
# Ablauf: Vorschau-Builds erzeugen (Basis aus `git show REF:...`, Neu aus dem Arbeitsverzeichnis, alle mit demselben
# Zeitstempel) -> Cockpit-Mocks auf freien Ports starten -> Suites nacheinander -> Mocks beenden -> Zusammenfassung.
# Exit-Code 0 = alles gruen, 1 = mindestens ein Test rot oder eine Suite abgestuerzt, 2 = Voraussetzung fehlt.
# Ausgaben (Logs, Builds, Screenshots) liegen in tests/out/ (nicht im Git).
set -u

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 2
ROOT=$PWD
T=$ROOT/tests
OUT=$T/out
REF=HEAD
ONLY=""
for a in "$@"; do
  case "$a" in
    --only=*) ONLY=${a#--only=} ;;
    -h|--help) sed -n '2,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "Unbekannte Option: $a" >&2; exit 2 ;;
    *) REF=$a ;;
  esac
done

# Feste Zeitzone: Vorschau-Termine und Browser rechnen beide in Berlin, egal wo der Rechner steht (CI = UTC)
export TZ=Europe/Berlin

# ---------------------------------------------------------------- Voraussetzungen
need() { command -v "$1" >/dev/null 2>&1 || { echo "Fehlt: $1 ($2)" >&2; exit 2; }; }
need git "Git"; need python3 "Python 3.9+"; need node "Node 18+"
(cd "$T" && node -e "require('playwright')") >/dev/null 2>&1 || {
  echo "Fehlt: Node-Paket 'playwright'. Einmalig:  cd tests && npm install   (danach: npx playwright install chromium)" >&2; exit 2; }
git rev-parse --verify --quiet "$REF^{commit}" >/dev/null || { echo "Unbekannter Git-Stand: $REF" >&2; exit 2; }
for f in template.html scripts/live_patch.js; do
  git cat-file -e "$REF:$f" 2>/dev/null || { echo "$f gibt es in $REF nicht" >&2; exit 2; }
done

# ---------------------------------------------------------------- Aufraeumen (Mocks immer beenden)
PIDS=()
stop_mocks() {
  local p
  for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null; done
  for p in "${PIDS[@]:-}"; do [ -n "$p" ] && wait "$p" 2>/dev/null; done
  PIDS=()
}
trap 'stop_mocks' EXIT
trap 'echo; echo "Abgebrochen."; exit 130' INT TERM

free_ports() {   # n freie Ports (kurz binden, dann freigeben)
  python3 - "$1" <<'PY'
import socket, sys
socks = [socket.socket() for _ in range(int(sys.argv[1]))]
for s in socks: s.bind(("127.0.0.1", 0))
print(*[s.getsockname()[1] for s in socks])
PY
}
start_mock() {   # Port -> Mock starten und warten, bis er lauscht
  local port=$1 i
  node "$T/cockpit-mock.js" "$port" geheim-123 >"$OUT/logs/mock-$port.log" 2>&1 &
  PIDS+=($!)
  for i in $(seq 1 50); do
    (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null && return 0
    sleep 0.1
  done
  echo "Mock auf Port $port startet nicht (siehe $OUT/logs/mock-$port.log)" >&2
  return 1
}

# ---------------------------------------------------------------- Builds
case "$OUT" in */tests/out) rm -rf "$OUT" ;; *) echo "Unerwarteter Ausgabepfad: $OUT" >&2; exit 2 ;; esac
mkdir -p "$OUT/logs" "$OUT/build/base-root/scripts" "$OUT/shots"

STAMP=$(date +%Y-%m-%dT%H:%M:%S)      # ein Zeitstempel fuer alle Builds (Basis und Neu identisch, kein Minutensprung)
git show "$REF:template.html" >"$OUT/build/base-root/template.html"
git show "$REF:scripts/live_patch.js" >"$OUT/build/base-root/scripts/live_patch.js"
mp() { python3 "$T/make_preview.py" "$1" "$2" --now "$STAMP" ${3:+--variant "$3"} >/dev/null; }
B=$OUT/build
mp "$ROOT" "$B/new.html" &&
mp "$ROOT" "$B/new-noceo.html" noceo && mp "$OUT/build/base-root" "$B/base-noceo.html" noceo &&
mp "$ROOT" "$B/new-nodates.html" nodates && mp "$OUT/build/base-root" "$B/base-nodates.html" nodates || {
  echo "Vorschau-Build fehlgeschlagen" >&2; exit 2; }
echo "Basis: $REF ($(git rev-parse --short "$REF"))   Neu: Arbeitsverzeichnis   Zeitstempel: $STAMP   Zeitzone: $TZ"
echo

# ---------------------------------------------------------------- Suites
declare -a NAMES=() RES=() DETAIL=() TIMES=()
want() { [ -z "$ONLY" ] || [[ ",$ONLY," == *",$1,"* ]]; }

run_suite() {   # name  -- Befehl ...  (Log nach tests/out/logs/<name>.log, Screenshots nach tests/out/shots/<name>)
  local name=$1; shift
  want "$name" || return 0
  local t0=$SECONDS rc line fails total det
  printf '%-6s ... ' "$name"
  (cd "$T" && "$@") >"$OUT/logs/$name.log" 2>&1; rc=$?
  line=$(grep -E '^[0-9]+ FAIL / [0-9]+$' "$OUT/logs/$name.log" | tail -1)
  NAMES+=("$name"); TIMES+=("$((SECONDS - t0))s")
  if [ -z "$line" ]; then
    RES+=("ABSTURZ"); DETAIL+=("keine Ergebniszeile, Exit $rc (siehe tests/out/logs/$name.log)")
    echo "ABSTURZ (Exit $rc)"; return
  fi
  fails=${line%% *}; total=${line##* }
  if [ "$rc" -eq 0 ] && [ "$fails" -eq 0 ] && [ "$total" -gt 0 ]; then
    RES+=("OK"); det="$total/$total"
  else
    RES+=("FEHLER"); det="$((total - fails))/$total, $fails rot"
  fi
  DETAIL+=("$det")
  echo "$det  ($((SECONDS - t0))s)"
}

run_suite theme node theme-test.js "$B/new.html" "$OUT/shots/theme"

if want ck; then
  read -r CK_PORT CK_DEAD <<<"$(free_ports 2)"
  start_mock "$CK_PORT" || exit 2
  run_suite ck node ck-test.js "$B/base-nodates.html" "$B/new-nodates.html" "$OUT/shots/ck" "$CK_PORT" "$CK_DEAD"
  stop_mocks
fi

if want ceo; then
  read -r P1 P2 P3 <<<"$(free_ports 3)"
  start_mock "$P1" && start_mock "$P2" && start_mock "$P3" || exit 2
  run_suite ceo node ceo-test.js "$B/new.html" "$OUT/shots/ceo" "$P1" "$P2" "$P3"
  stop_mocks
fi

run_suite glass node glass-test.js "$B/base-noceo.html" "$B/new-noceo.html" "$OUT/shots/glass"

# ---------------------------------------------------------------- Zusammenfassung
echo
echo "================ Zusammenfassung (Basis $REF) ================"
bad=0
for i in "${!NAMES[@]}"; do
  printf '%-7s %-8s %-18s %s\n' "${NAMES[$i]}" "${RES[$i]}" "${DETAIL[$i]}" "${TIMES[$i]}"
  if [ "${RES[$i]}" != OK ]; then
    bad=1
    grep -E '^FAIL' "$OUT/logs/${NAMES[$i]}.log" | cut -c1-240 | head -15 | sed 's/^/    /'
    [ "${RES[$i]}" = ABSTURZ ] && tail -8 "$OUT/logs/${NAMES[$i]}.log" | cut -c1-240 | sed 's/^/    /'
  fi
done
[ "${#NAMES[@]}" -eq 0 ] && { echo "Keine Suite gewaehlt (--only=$ONLY)."; bad=1; }
echo "Gesamtzeit: ${SECONDS}s   Logs/Screenshots: tests/out/"
if [ "$bad" -eq 0 ]; then echo "ALLES GRUEN"; else echo "ROT"; fi
exit "$bad"
