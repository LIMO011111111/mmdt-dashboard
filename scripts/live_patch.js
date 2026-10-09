// Applied by build_dashboard.py right after TUM_LIVE. Runs before DOMContentLoaded, so init() renders with live data.
(function applyTumLive() {
  const L = window.TUM_LIVE || (typeof TUM_LIVE !== 'undefined' ? TUM_LIVE : null);
  if (!L) return;
  const known = new Set(MODULES.map(m => m.id));
  const name = id => { const m = MODULES.find(x => x.id === id); return m ? m.t : id; };

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
    if (/^[1-4]$/.test(String(me.cursem))) state.cursem = String(me.cursem);
    Object.keys(me.picked || {}).forEach(c => { if (known.has(c) && /^[1-4]$/.test(String(me.picked[c]))) state.picked[c] = String(me.picked[c]); });
    Object.keys(me.cs || {}).forEach(c => {
      if (!known.has(c) || state.picked[c] === undefined) return;
      const cur = (state.cs && state.cs[c]) || {};
      state.cs[c] = { s: me.cs[c].s, g: me.cs[c].g || '', n: cur.n || '' };
    });
    state.cs = sanitizeCs(state.cs, state.picked);
    save();
    syncCourseStatus();
  }
})();
