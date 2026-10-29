// Applied by build_dashboard.py right after TUM_LIVE. Runs before DOMContentLoaded, so init() renders with live data.
// v22: Fehler hier brechen das Skript nicht mehr ab (sonst blieb GCAL_STATIC dahinter unerreichbar).
(function applyTumLive() {
  const L = window.TUM_LIVE || (typeof TUM_LIVE !== 'undefined' ? TUM_LIVE : null);
  if (!L) return;
  try {
  const known = new Set(MODULES.map(m => m.id));
  const name = id => { const m = MODULES.find(x => x.id === id); return m ? m.t : id; };

  // v22: Kursdaten der Vorlage gelten nur fuer ihr Semester (TEMPLATE_SEM = 26W). Fuer ein anderes Semester zaehlen nur die
  // Daten aus diesem Build: Angebot, Wochenraster, Blockkurse, Einzeltermine/Termintexte der Vorlage werden verworfen.
  if (typeof TEMPLATE_SEM !== 'undefined' && /^\d{2}[WS]$/.test(String(L.semester)) && L.semester !== TEMPLATE_SEM) {
    WS2627.clear(); (state.cust || []).forEach(c => WS2627.add(c.id));
    Object.keys(SCHEDULE).forEach(c => { delete SCHEDULE[c]; });
    Object.keys(SCHEDULE_BLOCKS).forEach(c => { delete SCHEDULE_BLOCKS[c]; });
    Object.keys(SKAL_DATA).forEach(c => { SKAL_DATA[c].dates = []; delete SKAL_DATA[c].termine; delete SKAL_DATA[c].bewerbung; });
  }

  // --- course offer, weekly plan, dates
  (L.ws || []).forEach(c => { if (known.has(c)) WS2627.add(c); });
  Object.keys(L.schedule || {}).forEach(c => { if (known.has(c)) SCHEDULE[c] = L.schedule[c]; });
  Object.keys(L.blocks || {}).forEach(c => {
    if (!known.has(c) || SCHEDULE[c]) return;
    const b = L.blocks[c];
    SCHEDULE_BLOCKS[c] = typeof b === 'string' ? b : (b.de || b.en);
  });
  Object.keys(L.skal || {}).forEach(c => { if (known.has(c)) SKAL_DATA[c] = Object.assign({}, SKAL_DATA[c] || {}, L.skal[c]); });
  Object.keys(L.exams || {}).forEach(c => {
    if (!known.has(c) || EXAMS[c]) return;
    const e = L.exams[c];
    EXAMS[c] = { text: e.de || e.en || '', textEn: e.en || '', verified: true, src: 'Modulhandbuch ' + (L.handbookStand || '') };
  });
  if (typeof SKAL_META !== 'undefined') { SKAL_META.stand = L.stand; SKAL_META.quelle = 'TUMonline (persönlicher Kalender + Kursangebot)'; }

  // --- exam dates of registered exams as deadlines
  if (typeof DEADLINES !== 'undefined' && L.examDates) {
    Object.keys(L.examDates).forEach(c => {
      if (!known.has(c)) return;
      DEADLINES.push({ id: 'tum-exam-' + c, course: c, date: L.examDates[c], type: 'pruefung', link: TUMONLINE_URL,
        title: { de: `Prüfung ${name(c)} (${c})`, en: `Exam ${name(c)} (${c})` },
        action: { de: 'Angemeldet laut TUMonline', en: 'Registered according to TUMonline' } });
    });
  }

  // --- texts: status line and footer in every language
  const hb = L.handbookStand ? ` · Modulhandbuch ${L.handbookStand}` : '';
  const hbEn = L.handbookStand ? ` · module handbook ${L.handbookStand}` : '';
  if (I18N.de) { I18N.de.stand_line = `Live aus TUMonline · Stand ${L.stand}`; I18N.de.footer_right = `Basis: TUMonline ${L.stand}${hb} · erzeugt von mmdt-dashboard`; }
  if (I18N.en) { I18N.en.stand_line = `Live from TUMonline · as of ${L.stand}`; I18N.en.footer_right = `Source: TUMonline ${L.stand}${hbEn} · built by mmdt-dashboard`; }
  if (I18N.it) { I18N.it.stand_line = `Dati live da TUMonline · al ${L.stand}`; I18N.it.footer_right = `Fonte: TUMonline ${L.stand}${hb} · generato da mmdt-dashboard`; }

  // --- your own data: passed modules with grades, pending exams, fixed-place courses. TUMonline facts win,
  //     everything you set by hand for other courses (wait list, notes, plans) stays.
  const me = L.me;
  if (me && typeof state !== 'undefined') {
    // v22: Semester aus TUMonline nur, solange du es nicht selbst gewaehlt hast (state.cursemManual, zuruecksetzen mit "Automatisch")
    if (/^[1-4]$/.test(String(me.cursem)) && !state.cursemManual) state.cursem = String(me.cursem);
    // wait list from Moodle is only a guess: never overrides a semester or status you chose yourself
    const guess = c => me.cs && me.cs[c] && me.cs[c].src === 'moodle';
    const ownStatus = c => state.cs && state.cs[c] && state.cs[c].s && state.cs[c].s !== 'geplant';
    // a course you crossed out ("Abgemeldet") stays out, even if TUMonline still lists a place; only a passed exam overrides it
    const dropped = c => state.cs && state.cs[c] && state.cs[c].s === 'abgemeldet';
    Object.keys(me.picked || {}).forEach(c => {
      if (!known.has(c) || !/^[1-4]$/.test(String(me.picked[c]))) return;
      if (guess(c) && state.picked[c] !== undefined) return;
      state.picked[c] = String(me.picked[c]);
    });
    Object.keys(me.cs || {}).forEach(c => {
      if (!known.has(c) || state.picked[c] === undefined) return;
      if (guess(c) && (ownStatus(c) || state.picked[c] !== String(me.picked[c]))) return;
      if (dropped(c) && me.cs[c].s !== 'bestanden') return;
      const cur = (state.cs && state.cs[c]) || {};
      state.cs[c] = { s: me.cs[c].s, g: me.cs[c].g || '', n: cur.n || '' };
    });
    state.cs = sanitizeCs(state.cs, state.picked);
    // thesis: the template defaults to a fixed date; as long as you have not set a thesis semester or date yourself,
    // plan it for semester 4 of your actual program (counted from your first semester, e.g. 26S -> 27W -> 01.10.2027)
    // (state.thesis.manual is set by the dashboard as soon as you touch the thesis semester or date, also when you reset it to "-")
    if (state.picked.THESIS === undefined && typeof semesterStartIso === 'function' && typeof THESIS_DEFAULT_START !== 'undefined'
        && !(state.thesis && state.thesis.manual)
        && (!state.thesis || !state.thesis.start || state.thesis.start === THESIS_DEFAULT_START)) {
      state.picked.THESIS = '4';
      state.thesis = Object.assign({ done: {}, ics: false }, state.thesis || {}, { start: semesterStartIso(4) });
    }
    save();
    syncCourseStatus();
  }
  } catch (e) { console.error('[Dashboard] TUM_LIVE konnte nicht uebernommen werden:', e); }
})();
