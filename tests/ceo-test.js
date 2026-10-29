// v20 Sessions mit Pruefung (CEO Strategy Series, MGTHN0130): node ceo-test.js <preview.html> <shotDir> [port1=8788] [port2=port1+1] [port3=port1+2]
// Drei frische Mocks starten: node cockpit-mock.js <port1|port2|port3> geheim-123 (nach dem Test beenden; tests/run.sh macht das)
// Prueft: rote Punkte = kommende Sessions (je Tag einer), Popover-Text (DE/EN/IT), Demnaechst, Push an den Mock (Anzahl, Felder,
// Marker, kein zweiter Push nach Reload, Schalter aus, Kurs abgewaehlt), Dedupe (ICS-Frist, Kalender, Cockpit-Aufgabe), erledigt,
// keine Fehler, kein Ueberlauf 390px, Klassisch + Glas hell/dunkel (Screenshots).
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const [file, out, portArg, port2Arg, port3Arg] = process.argv.slice(2);
const PORT = +(portArg || 8788), MOCK = 'http://127.0.0.1:' + PORT, MOCK_T1 = 'http://127.0.0.1:' + +(port2Arg || PORT + 1), MOCK_T2 = 'http://127.0.0.1:' + +(port3Arg || PORT + 2);
fs.mkdirSync(out, { recursive: true });
const results = [];
const ok = (name, cond, info = '') => results.push([cond ? 'OK  ' : 'FAIL', name, info]);
const mockLog = () => fetch(MOCK + '/__log').then(r => r.json());
const ceoPosts = async () => (await mockLog()).filter(b => b.aktion === 'frist' && /^ceo:/.test(b.quelle_marker || ''));
const LSP = { mmdt_cockpit_token: 'geheim-123', mmdt_cockpit_url: MOCK + '/mmdt' };

// Erwartung unabhaengig vom Dashboard: make_preview.py legt MGTHN0130 auf Do 17-19 Uhr, Wochen -2 .. +11 ab Montag dieser Woche
const pad = n => String(n).padStart(2, '0');
const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = new Date(); today.setHours(0, 0, 0, 0);
const mon = new Date(today); mon.setDate(today.getDate() - ((today.getDay() + 6) % 7));
const ALL = []; for (let i = -2; i < 12; i++) { const d = new Date(mon); d.setDate(mon.getDate() + 3 + 7 * i); ALL.push(d); }
const SEM_START = new Date(2026, 9, 12);
const UP = ALL.filter(d => d >= today).map(isoOf);                       // kommende Sessions (heute zaehlt mit)
const SOON = ALL.filter(d => d >= today && (d - today) / 864e5 <= 21).map(isoOf);
const PAST_IN_SEM = ALL.filter(d => d < today && d >= SEM_START).map(isoOf);

async function open(browser, { w = 390, scheme = 'light', style = null, ls = {}, prep = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, isMobile: w < 800, hasTouch: w < 800, colorScheme: scheme, deviceScaleFactor: 2, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
  await p.goto('file://' + file); await p.waitForTimeout(200);
  await p.evaluate(([ls, st]) => { localStorage.clear(); Object.keys(ls).forEach(k => localStorage.setItem(k, ls[k])); if (st) localStorage.setItem('mmdt_style', st); }, [ls, style]);
  if (prep) await p.evaluate(prep);
  await p.reload(); await p.waitForTimeout(800);
  return { ctx, p, errs };
}
// Punkte der Semesterleiste: Tag (ISO) -> { past, ceo }
const dotInfo = p => p.evaluate(() => [...document.querySelectorAll('#semb .semb-dot')].map(b => {
  const dn = +b.dataset.dn, ev = SEM_EV.filter(x => x.dn === dn);
  return { iso: D14.toIso(dn), past: b.classList.contains('past'), ceo: ev.some(x => x.code === 'MGTHN0130' || /CEO Strategy/.test(x.kurs + x.was)), n: ev.length };
}));
const soonTiles = p => p.$$eval('#aufgaben-soon .td-soon-tile', l => l.map(x => ({ cls: x.className, t: x.querySelector('.st-t').textContent, m: x.querySelector('.st-m').textContent, title: x.title })));
const soonAll = p => p.evaluate(() => { const on = ckKurse().filter(k => !state.aufgOff[k.id]), l = ckSoon(on); exSoon(on, l); return l.map(o => (o.ex ? 'EX:' : '') + o.dt.rest + '@' + o.dt.days); });   // ganze Demnaechst-Liste (Kacheln zeigen max. 6)
const over = p => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
async function tapDot(p, iso) {
  await p.evaluate(iso => { const b = document.querySelector(`#semb .semb-dot[data-dn="${D14.fromIso(iso)}"]`); b.scrollIntoView({ block: 'center' }); }, iso);
  await p.evaluate(iso => document.querySelector(`#semb .semb-dot[data-dn="${D14.fromIso(iso)}"]`).click(), iso);   // Klick direkt auf den Punkt (Nachbarn ueberlappen auf 390px)
  await p.waitForTimeout(150);
  return p.evaluate(() => { const pop = document.querySelector('#semb .semb-pop'); return pop.hidden ? null : pop.textContent.replace(/\s+/g, ' ').trim(); });
}

(async () => {
  const browser = await chromium.launch();

  // 1) Lokal (ohne Token): Punkte, Popover, Demnaechst, Sprachen, Klassisch/Glas, hell/dunkel
  for (const [style, scheme] of [[null, 'light'], [null, 'dark'], ['glass', 'light'], ['glass', 'dark']]) {
    const nm = `${style ? 'Glas' : 'Klassisch'} ${scheme}`;
    const { ctx, p, errs } = await open(browser, { style, scheme, ls: { mmdt_theme: scheme } });
    const dots = await dotInfo(p), ceo = dots.filter(d => d.ceo);
    const red = ceo.filter(d => !d.past).map(d => d.iso).sort(), past = ceo.filter(d => d.past).map(d => d.iso).sort();
    ok(`${nm}: rote Punkte = kommende CEO-Sessions (${UP.length})`, red.join() === UP.join(), red.join());
    ok(`${nm}: vergangene Sessions im Semester als blasse Punkte (${PAST_IN_SEM.length})`, past.join() === PAST_IN_SEM.join(), past.join());
    ok(`${nm}: je Tag ein Punkt, je Session-Tag ein Eintrag`, new Set(dots.map(d => d.iso)).size === dots.length && ceo.every(d => d.n === 1), JSON.stringify(ceo.filter(d => d.n !== 1)));
    const pop = await tapDot(p, UP[0]);
    ok(`${nm}: Tap zeigt "CEO Strategy Series · Prüfung · Session + Quiz · 17:00"`, !!pop && /CEO Strategy Series/.test(pop) && /Prüfung/.test(pop) && /Session \+ Quiz/.test(pop) && /17:00/.test(pop), pop);
    await p.evaluate(() => semPop(null));
    const box = await (await p.$(`#semb .semb-dot[data-dn="${await p.evaluate(iso => D14.fromIso(iso), UP[0])}"]`)).boundingBox();
    await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await p.waitForTimeout(150);
    const pop2 = await p.evaluate(() => { const x = document.querySelector('#semb .semb-pop'); return x.hidden ? '' : x.textContent; });
    ok(`${nm}: echter Tap auf den Punkt zeigt die Session (ggf. mit Nachbartagen)`, pop2.includes(UP[0].split('-').reverse().join('.')) && pop2.includes('Session + Quiz'), pop2.slice(0, 160));
    await p.evaluate(() => semPop(null));
    const tiles = await soonTiles(p), ex = tiles.filter(x => x.t === 'Session + Quiz');
    ok(`${nm}: Demnaechst zeigt ${Math.min(SOON.length, 4)} kommende Sessions als Pruefung`, ex.length === Math.min(SOON.length, 4) && ex.every(x => /frist/.test(x.cls) && /✍️/.test(x.m) && /Prüfung/.test(x.m) && /CEO Strategy Series/.test(x.m) && x.title === 'CEO Strategy Series · Session + Quiz'), JSON.stringify(tiles));
    ok(`${nm}: kein Ueberlauf 390px`, (await over(p)) === 0, String(await over(p)));
    const tag = `${style ? 'glas' : 'klassisch'}-${scheme}`;
    await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(100);
    await tapDot(p, UP[0]); await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(150);
    if (!(await p.evaluate(() => !document.querySelector('#semb .semb-pop').hidden))) await tapDot(p, UP[0]);
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.screenshot({ path: path.join(out, `semb-pop-${tag}.png`), clip: { x: 0, y: 0, width: 390, height: 300 } });
    await p.evaluate(() => { semPop(null); document.getElementById('aufgaben-soon').scrollIntoView({ block: 'center' }); }); await p.waitForTimeout(200);
    await (await p.$('#aufgaben-soon')).screenshot({ path: path.join(out, `demnaechst-${tag}.png`) });
    ok(`${nm}: keine Fehler`, !errs.length, errs.join(' | '));
    await ctx.close();
  }
  // Sprachen EN/IT
  for (const [lang, word, lab] of [['en', 'Exam', 'Session + quiz'], ['it', 'Esame', 'Sessione + quiz']]) {
    const { ctx, p, errs } = await open(browser, { prep: lang => { state.lang = lang; save(); } });
    await p.evaluate(lang => { state.lang = lang; save(); applyTranslations(); renderAll(); }, lang); await p.waitForTimeout(200);
    const pop = await tapDot(p, UP[0]), tiles = await soonTiles(p);
    ok(`Sprache ${lang}: Popover "${word}" + "${lab}", Demnaechst-Label`, !!pop && pop.includes(word) && pop.includes(lab) && tiles.some(x => x.t === lab), pop + ' / ' + tiles.map(x => x.t).join(','));
    ok(`Sprache ${lang}: keine Fehler`, !errs.length, errs.join(' | '));
    await ctx.close();
  }

  // 2) Kurs abgewaehlt / auf Warteliste (unsicher) -> keine Markierungen, kein Demnaechst
  for (const [nm, prep] of [['abgemeldet', () => { state.cs.MGTHN0130 = { s: 'abgemeldet', g: '' }; save(); }],
                            ['anderes Semester', () => { state.picked.MGTHN0130 = '3'; save(); }]]) {
    const { ctx, p, errs } = await open(browser, { prep });
    await p.evaluate(prep); await p.evaluate(() => renderAll()); await p.waitForTimeout(150);
    const dots = await dotInfo(p), tiles = await soonTiles(p);
    ok(`Kurs ${nm}: keine CEO-Punkte, kein Demnaechst, keine Kandidaten`, !dots.some(d => d.ceo) && !tiles.some(x => /Session/.test(x.t))
      && await p.evaluate(() => !exSessions().length && !ckFristKandidaten().some(x => /^ceo:/.test(x.marker))), JSON.stringify(dots.filter(d => d.ceo)));
    ok(`Kurs ${nm}: keine Fehler`, !errs.length, errs.join(' | '));
    await ctx.close();
  }
  // Wieder gewaehlt (Live-Umschalten ohne Reload): Punkte kommen zurueck
  {
    const { ctx, p, errs } = await open(browser);
    await p.evaluate(() => { state.cs.MGTHN0130 = { s: 'abgemeldet', g: '' }; save(); renderAll(); });
    const n0 = (await dotInfo(p)).filter(d => d.ceo).length;
    await p.evaluate(() => { state.cs.MGTHN0130 = { s: 'fixplatz', g: '' }; save(); renderAll(); });
    const n1 = (await dotInfo(p)).filter(d => d.ceo).length;
    ok('Abwaehlen/Waehlen live: Punkte verschwinden und kommen zurueck', n0 === 0 && n1 === UP.length + PAST_IN_SEM.length, `${n0} -> ${n1}`);
    ok('Abwaehlen/Waehlen live: keine Fehler', !errs.length, errs.join(' | '));
    await ctx.close();
  }

  // 3) Kalender: ergaenzt nur passende Slots (gleicher Wochentag +-30 Min oder verschobene Session mit Kursnamen), nie Push;
  //    private Termine mit Modulcode ignoriert; "wichtig"-Termin (keine Abgabe) gewinnt, Abgabe bleibt neben der Session sichtbar
  {
    const { ctx, p, errs } = await open(browser);
    const addD = (iso, k) => { const d = new Date(iso + 'T12:00'); d.setDate(d.getDate() + k); return isoOf(d); };
    const last = UP[UP.length - 1], A = UP[1], B = UP[2];
    const r = await p.evaluate(([A, B, wkNext, wedMoved, monLern, thuOff]) => {
      const n0 = exSessions().length;
      const ev = (d, hm, title, extra) => Object.assign({ id: 'x' + d + hm + title, title, start: d + 'T' + hm + ':00+01:00', end: d + 'T' + (+hm.slice(0, 2) + 2) + hm.slice(2) + ':00+01:00', allDay: false, location: '', colorId: '', code: 'MGTHN0130', uni: true, online: false, free: false, wichtig: null }, extra || {});
      gcalApply({ stand: GCAL_STATIC.stand, events: GCAL_STATIC.events.concat([
        ev(A, '17:00', 'CEO Strategy Series (MGTHN0130)'),                 // Session-Tag: nicht doppelt
        ev(wkNext, '17:15', 'CEO Strategy Series (MGTHN0130)'),            // Do, +15 Min, nach dem letzten TUM-Termin -> ergaenzt
        ev(wedMoved, '17:00', 'CEO Strategy Series – verschoben'),          // Mi statt Do, Kursname -> ergaenzt (verschoben)
        ev(monLern, '17:00', 'Lerngruppe MGTHN0130'),                       // Mo, ohne Kursnamen -> ignoriert
        ev(thuOff, '09:00', 'Lerngruppe MGTHN0130'),                        // Do 09:00 (falsche Zeit) -> ignoriert
        ev(A, '23:00', 'Quiz-Klausur CEO Strategy', { wichtig: { kurs: 'CEO Strategy', was: 'Quiz-Klausur', abgabe: false } }),
        ev(B, '23:00', 'DEADLINE CEO Strategy Essay', { wichtig: { kurs: 'CEO Strategy', was: 'Essay', abgabe: true } }) ]) });
      const all = exSessions(), dd = iso => SEM_EV.filter(x => x.dn === D14.fromIso(iso)).map(x => x.was + (x.ex ? ':ex' : ''));
      return { n0, kal: all.filter(x => x.src === 'kal').map(x => D14.toIso(x.dn)).sort(), cand: ckFristKandidaten().filter(x => /^ceo:/.test(x.marker)).map(x => x.marker.slice(4)),
        a: dd(A), b: dd(B), lern: dd(monLern).concat(dd(thuOff)) };
    }, [A, B, addD(last, 7), addD(B, -1), addD(B, -3), addD(last, 14)]);
    ok('Kalender: nur passende Slots ergaenzt (Do +15 Min, verschobene Session mit Kursnamen)', r.kal.join() === [addD(B, -1), addD(last, 7)].sort().join(), r.kal.join(','));
    ok('Kalender: private Termine mit Modulcode (Lerngruppe) ohne Punkt', !r.lern.length, r.lern.join(','));
    ok('Kalender: aus Kalender-Sessions wird nie gepusht', r.cand.join() === UP.join(), r.cand.join(','));
    ok('Kalender: wichtig-Termin (keine Abgabe) am Session-Tag gewinnt', r.a.length === 1 && r.a[0] === 'Quiz-Klausur', r.a.join(','));
    ok('Kalender: Abgabe-Termin am Session-Tag bleibt neben der Session sichtbar', r.b.length === 2 && r.b.includes('Essay') && r.b.includes('Session + Quiz:ex'), r.b.join(','));
    ok('Kalender: keine Fehler', !errs.length, errs.join(' | '));
    await ctx.close();
  }
  // 3b) Status "geplant": Punkte + Demnaechst ja, Push nein; Sessions ausserhalb des Semesters nie pushen
  {
    const prep = () => { state.cs.MGTHN0130 = { s: 'geplant', g: '' }; save(); };
    const { ctx, p, errs } = await open(browser, { prep });
    await p.evaluate(prep); await p.evaluate(() => renderAll());
    const r = await p.evaluate(() => ({ st: COURSE_STATUS.MGTHN0130.status, ex: exSessions().length, cand: ckFristKandidaten().filter(x => /^ceo:/.test(x.marker)).length,
      dots: SEM_EV.filter(x => x.ex).length, soon: [...document.querySelectorAll('#aufgaben-soon .st-t')].filter(x => x.textContent === 'Session + Quiz').length }));
    ok('Geplant (kein sicherer Platz): Punkte + Demnaechst, aber kein Push', r.st === 'geplant' && r.dots > 0 && r.soon > 0 && r.cand === 0, JSON.stringify(r));
    const r2 = await p.evaluate(() => { state.cs.MGTHN0130 = { s: 'fixplatz', g: '' }; save(); renderAll();
      SKAL_DATA.MGTHN0130.dates = SKAL_DATA.MGTHN0130.dates.concat(['08.04.2027 17:00-19:00']);
      return ckFristKandidaten().filter(x => /^ceo:/.test(x.marker)).map(x => x.marker.slice(4)); });
    ok('Fixplatz: Session nach Semesterende (08.04.2027) wird nicht gepusht', r2.length === UP.length && !r2.includes('2027-04-08'), r2.join(','));
    ok('Geplant/Semesterende: keine Fehler', !errs.length, errs.join(' | '));
    await ctx.close();
  }
  // 3c) Zwei Tabs gleichzeitig: jeder Marker genau einmal (Web Locks bzw. localStorage-Lease ohne Web Locks)
  for (const [nm, mock, noLocks] of [['Web Locks', MOCK_T1, false], ['Lease ohne Web Locks', MOCK_T2, true]]) {
    const ctx = await browser.newContext({ locale: 'de-DE', timezoneId: 'Europe/Berlin' });
    if (noLocks) await ctx.addInitScript(() => { try { Object.defineProperty(Navigator.prototype, 'locks', { get: () => undefined, configurable: true }); } catch (e) {} });
    const a = await ctx.newPage(), errs = []; a.on('pageerror', e => errs.push(e.message));
    await a.goto('file://' + file);
    await a.evaluate(m => { localStorage.clear(); localStorage.setItem('mmdt_cockpit_token', 'geheim-123'); localStorage.setItem('mmdt_cockpit_url', m + '/mmdt'); localStorage.setItem('mmdt_cockpit_push', '0'); }, mock);
    const b = await ctx.newPage(); b.on('pageerror', e => errs.push(e.message));
    await Promise.all([a.reload(), b.goto('file://' + file)]);
    await Promise.all([a.waitForFunction(() => window.COCKPIT), b.waitForFunction(() => window.COCKPIT)]);
    const locks = await a.evaluate(() => !!(navigator.locks && navigator.locks.request));
    await a.evaluate(() => localStorage.removeItem('mmdt_cockpit_push'));
    await Promise.all([a.evaluate(() => ckPushRun()), b.evaluate(() => ckPushRun())]);
    await a.waitForTimeout(3500);
    const posts = (await (await fetch(mock + '/__log')).json()).filter(x => /^ceo:/.test(x.quelle_marker || ''));
    const cnt = {}; posts.forEach(x => cnt[x.quelle_marker] = (cnt[x.quelle_marker] || 0) + 1);
    ok(`Zwei Tabs (${nm}${locks === !noLocks ? '' : ' !Pfad'}): ${UP.length} POSTs statt ${2 * UP.length}, jeder Marker einmal`, posts.length === UP.length && Object.values(cnt).every(v => v === 1), `${posts.length} POSTs, ${Object.keys(cnt).length} Marker`);
    ok(`Zwei Tabs (${nm}): Merkliste vollstaendig, Lease freigegeben, keine Fehler`, await a.evaluate(up => { const o = JSON.parse(localStorage.getItem('mmdt_cockpit_pushed') || '{}'); return up.every(d => o['ceo:' + d] > 0) && !localStorage.getItem('mmdt_cockpit_push_lease'); }, UP) && !errs.length, errs.join(' | '));
    await ctx.close();
  }
  // 3d) Zeitzonen: Geraet in Auckland / Los Angeles -> gleiche Tage wie Berlin (Punkte, Demnaechst, Kandidaten)
  {
    const res = {};
    for (const tz of ['Europe/Berlin', 'Pacific/Auckland', 'America/Los_Angeles']) {
      const ctx = await browser.newContext({ locale: 'de-DE', timezoneId: tz }); const p = await ctx.newPage();
      await p.goto('file://' + file); await p.waitForTimeout(500);
      res[tz] = await p.evaluate(() => { const on = aufgabenKurse().filter(k => !state.aufgOff[k.id]), l = []; exSoon(on, l);
        return { today: D14.toIso(exToday()), red: [...document.querySelectorAll('#semb .semb-dot.ex:not(.past)')].map(b => D14.toIso(+b.dataset.dn)).join(),
          soon: l.map(o => o.dt.days + '@' + o.dt.d.getDate()).join(), cand: ckFristKandidaten().filter(x => /^ceo:/.test(x.marker)).map(x => x.marker).join() }; });
      await ctx.close();
    }
    const B = JSON.stringify(res['Europe/Berlin']);
    ok('Zeitzonen: Auckland und Los Angeles rechnen wie Berlin (heute, Punkte, Demnaechst, Push)', ['Pacific/Auckland', 'America/Los_Angeles'].every(z => JSON.stringify(res[z]) === B), JSON.stringify(res).slice(0, 300));
  }
  // 3e) Semesterleiste: "letzter Termin"/"% im Semester" ohne Session-Einfluss; Popover-Grenzen; Tipp-Flaeche; Glas-Popover deckend
  {
    const { ctx, p, errs } = await open(browser, { w: 320 });
    const r = await p.evaluate(() => {
      const txt = () => document.querySelector('#semb').innerText.replace(/\s+/g, ' ');
      const withEx = txt(); const saved = EXAM_EVERY_SESSION.MGTHN0130; delete EXAM_EVERY_SESSION.MGTHN0130; semRefresh(); const without = txt();
      EXAM_EVERY_SESSION.MGTHN0130 = saved; semRefresh();
      SEM_CAL = []; semRefresh(); const noCal = txt(); return { withEx, without, noCal };
    });
    ok('Leiste: Sessions aendern "letzter Termin" und "%" nicht', r.withEx === r.without, r.withEx + ' / ' + r.without);
    ok('Leiste: ohne Kalender Ende 05.02.2027 wie vorher', /05\.02\.2027/.test(r.noCal), r.noCal);
    await p.evaluate(() => { SKAL_DATA.MGTHN0130.dates = ['23.10.2026 14:30-17:15','04.11.2026 14:30-17:15','11.11.2026 14:30-17:15','18.11.2026 14:30-17:15','20.11.2026 14:30-17:15','25.11.2026 14:30-17:15','27.11.2026 14:30-17:15','16.12.2026 14:30-17:15','13.01.2027 14:30-17:15']; renderAll(); });
    const hit = await p.evaluate(() => { const b = document.querySelector('#semb .semb-dot.ex'); const cs = getComputedStyle(b, '::after'); return b.getBoundingClientRect().width - 2 * parseFloat(cs.left); });
    ok('Leiste: Tipp-Flaeche kleiner Punkte >= 24 px', hit >= 24, String(hit));
    let worst = { days: 0, h: 0 }, curFirst = true, moreSeen = false;
    for (const dn of await p.evaluate(() => [...document.querySelectorAll('#semb .semb-dot')].map(b => b.dataset.dn))) {
      const box = await (await p.$(`#semb .semb-dot[data-dn="${dn}"]`)).boundingBox();
      await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await p.waitForTimeout(40);
      const q = await p.evaluate(() => { const pop = document.querySelector('#semb .semb-pop'), heads = [...pop.children].filter(c => c.classList.contains('sp-d')), btn = document.querySelector('#semb .semb-dot.open');
        return { days: heads.length, h: pop.getBoundingClientRect().height, vh: innerHeight, first: heads[0] ? heads[0].textContent : '', open: btn ? D14.fmt(+btn.dataset.dn) : '', cur: heads.length < 2 || heads[0].classList.contains('cur'), more: !!pop.querySelector('.sp-more') }; });
      if (q.days > worst.days) worst.days = q.days; if (q.h > worst.h) worst.h = q.h;
      if (!q.first.includes(q.open) || !q.cur) curFirst = false; if (q.more) moreSeen = true;
      await p.evaluate(() => semPop(null));
    }
    ok('Popover: angetippter Tag zuerst + hervorgehoben, hoechstens 3 Tage, Hoehe <= 60 % (320 px, reale 9 Termine)', curFirst && worst.days <= 3 && worst.h <= 0.6 * 844, JSON.stringify(worst) + ' more:' + moreSeen);
    ok('Leiste/Popover: keine Fehler, kein Ueberlauf', !errs.length && (await over(p)) === 0, errs.join(' | '));
    await ctx.close();
    for (const [style, scheme, min] of [['glass', 'dark', 0.94], ['glass', 'light', 0.94], [null, 'dark', 1]]) {
      const o = await open(browser, { style, scheme, ls: { mmdt_theme: scheme } });
      await tapDot(o.p, UP[0]);
      const a = await o.p.evaluate(() => { const c = getComputedStyle(document.querySelector('#semb .semb-pop')).backgroundColor; const m = /rgba?\(([^)]+)\)/.exec(c); const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return v.length > 3 ? v[3] : 1; });
      ok(`Popover ${style ? 'Glas' : 'Klassisch'} ${scheme}: Deckkraft ${a} >= ${min}`, a >= min, String(a));
      await o.ctx.close();
    }
  }

  // 4) Cockpit: Push an den Mock
  {
    const before = (await ceoPosts()).length;
    const { ctx, p, errs } = await open(browser, { w: 1280, ls: LSP });
    await p.waitForFunction(() => window.COCKPIT, null, { timeout: 5000 }); await p.waitForTimeout(4500);
    const sent = (await ceoPosts()).slice(before), markers = sent.map(b => b.quelle_marker).sort();
    ok(`Push: ${UP.length} POST frist mit Marker ceo:<Tag> (nur kuenftige)`, markers.join() === UP.map(d => 'ceo:' + d).join(), markers.join(','));
    const bad = sent.filter(b => !(b.art === 'pruefung' && b.kurs === 'MGTHN0130' && b.faellig_am === b.quelle_marker.slice(4) && b.ganztags === true && b.aufgabe === true
      && b.vorlauf_tage === 0 && b.titel === 'CEO Strategy Series – Session + Quiz'));
    ok('Push: Felder nach Vertrag (art pruefung, kurs, Berliner Datum, ganztags, Aufgabe, Titel)', sent.length && !bad.length, JSON.stringify(bad[0] || sent[0]));
    ok('Push: Merkliste enthaelt alle Marker', await p.evaluate(up => { const o = JSON.parse(localStorage.getItem('mmdt_cockpit_pushed') || '{}'); return up.every(d => o['ceo:' + d] > 0); }, UP));
    ok('Push: Upload-Budget ueber alle Tabs mitgezaehlt (<= 30 je 10 Min)', await p.evaluate(() => CK_PUSH_WIN === 30 && ckPushTimesRead().length >= 1 && ckPushTimesRead().length <= 30));
    // nach dem Push: je Tag ein Eintrag (Cockpit-Frist + Session zusammengefasst), Demnaechst ohne Doppel
    const dots = await dotInfo(p), ceo = dots.filter(d => d.ceo);
    ok('Push: Semesterleiste weiter je Session-Tag ein Eintrag', ceo.length === UP.length + PAST_IN_SEM.length && ceo.every(d => d.n === 1), JSON.stringify(ceo.filter(d => d.n !== 1)));
    const tiles = await soonTiles(p);
    const all = await soonAll(p);
    ok('Push: Demnaechst ohne Doppel (Session statt Cockpit-Aufgabe), Kacheln konsistent', all.filter(x => x.startsWith('EX:')).length === SOON.length && !all.some(x => /CEO Strategy Series – Session/.test(x))
      && tiles.filter(x => x.t === 'Session + Quiz').length === all.slice().sort((a, b) => +a.split('@')[1] - +b.split('@')[1]).slice(0, 6).filter(x => x.startsWith('EX:')).length, all.join(' | '))
    // Aufgabe im Cockpit erledigt -> Session verschwindet aus Demnaechst
    const did = await p.evaluate(iso => { const f = COCKPIT.fristen.find(f => f.kurs === 'MGTHN0130' && String(f.faellig_am).slice(0, 10) === iso); if (!f || !f.aufgabe_id) return null; ckToggle(f.aufgabe_id, true); return f.aufgabe_id; }, SOON[0]);
    await p.waitForTimeout(800);
    const all2 = await soonAll(p);
    ok('Push: Cockpit-Aufgabe erledigt -> Session aus Demnaechst raus', !!did && all2.filter(x => x.startsWith('EX:')).length === SOON.length - 1 && !all2.some(x => x.startsWith('EX:') && x.endsWith('@' + Math.round((new Date(SOON[0] + 'T00:00') - today) / 864e5))), `${did} ${all2.join(' | ')}`)
    const pale = await p.evaluate(iso => { const b = document.querySelector(`#semb .semb-dot[data-dn="${D14.fromIso(iso)}"]`); return !!b && b.classList.contains('past'); }, SOON[0]);
    ok('Push: Cockpit-Aufgabe erledigt -> Punkt blass (wie vergangen)', pale);
    await p.evaluate(id => ckToggle(id, false), did); await p.waitForTimeout(600);
    ok('Push: wieder offen -> Punkt wieder rot', await p.evaluate(iso => !document.querySelector(`#semb .semb-dot[data-dn="${D14.fromIso(iso)}"]`).classList.contains('past'), SOON[0]));
    // Reload: kein zweiter Push
    const n1 = (await ceoPosts()).length;
    await p.reload(); await p.waitForFunction(() => window.COCKPIT, null, { timeout: 5000 }); await p.waitForTimeout(4000);
    ok('Push: nach Reload kein zweiter Push', (await ceoPosts()).length === n1, `${(await ceoPosts()).length - n1} neue`);
    ok('Push: keine Fehler', !errs.length, errs.join(' | '));
    ok('Push: kein Ueberlauf', (await over(p)) === 0);
    await ctx.close();
  }
  // Schalter aus (frische Merkliste) -> kein Push
  {
    const n0 = (await ceoPosts()).length;
    const { ctx, p, errs } = await open(browser, { ls: Object.assign({ mmdt_cockpit_push: '0' }, LSP) });
    await p.waitForFunction(() => window.COCKPIT, null, { timeout: 5000 }); await p.waitForTimeout(3500);
    ok('Schalter aus: kein Push', (await ceoPosts()).length === n0 && !(await p.isChecked('#ck-push')), String((await ceoPosts()).length - n0));
    ok('Schalter aus: keine Fehler', !errs.length, errs.join(' | '));
    await ctx.close();
  }
  // Kurs abgewaehlt (frische Merkliste, Schalter an) -> kein Push; schon uebertragene Fristen nicht markiert
  {
    const n0 = (await ceoPosts()).length;
    const prep = () => { state.cs.MGTHN0130 = { s: 'abgemeldet', g: '' }; save(); };
    const { ctx, p, errs } = await open(browser, { ls: LSP, prep });
    await p.evaluate(prep); await p.evaluate(() => renderAll());
    await p.waitForFunction(() => window.COCKPIT, null, { timeout: 5000 }); await p.waitForTimeout(3500);
    ok('Abgewaehlt: kein Push', (await ceoPosts()).length === n0, String((await ceoPosts()).length - n0));
    const dots = await dotInfo(p), tiles = await soonTiles(p);
    ok('Abgewaehlt: Cockpit-Fristen der Sessions weder Punkt noch Demnaechst', !dots.some(d => d.ceo) && !tiles.some(x => /Session/.test(x.t)) && await p.evaluate(() => COCKPIT.fristen.some(f => f.kurs === 'MGTHN0130')),
      JSON.stringify(dots.filter(d => d.ceo)) + ' ' + tiles.map(x => x.t).join(','));
    ok('Abgewaehlt: keine Fehler', !errs.length, errs.join(' | '));
    await ctx.close();
  }
  // Cockpit-Fristen am Session-Tag: andere Pruefung desselben Kurses (ICS "CEO Strategy" ohne Kurs, Klausur) -> kein Push, deren Eintrag statt Session;
  // Abgabe desselben Kurses -> eigener Eintrag/Kachel, Session bleibt und wird gepusht
  for (const [nm, f, expSem, expSoon, push] of [
    ['ICS-Pruefung ohne Kurs', { titel: 'CEO Strategy', kurs: null, art: 'pruefung' }, ['CEO Strategy'], ['CEO Strategy'], false],
    ['Abgabe desselben Kurses', { titel: 'Abgabe Reflexion CEO', kurs: 'MGTHN0130', art: 'abgabe' }, ['Abgabe Reflexion CEO', 'Session + Quiz'], ['Abgabe Reflexion CEO', 'Session + Quiz'], true],
    ['ICS-Abgabe ohne Kurs', { titel: 'CEO Strategy', kurs: null, art: 'abgabe' }, ['CEO Strategy', 'Session + Quiz'], ['CEO Strategy', 'Session + Quiz'], true],
    ['Klausur desselben Kurses', { titel: 'Klausur CEO Strategy Series', kurs: 'MGTHN0130', art: 'pruefung' }, ['Klausur CEO Strategy Series'], ['Klausur CEO Strategy Series'], false]]) {
    const { ctx, p, errs } = await open(browser, { ls: Object.assign({ mmdt_cockpit_push: '0' }, LSP) });
    await p.waitForFunction(() => window.COCKPIT, null, { timeout: 5000 });
    const r = await p.evaluate(([iso, f]) => {
      COCKPIT.fristen = COCKPIT.fristen.filter(x => x.kurs !== 'MGTHN0130');   // Stand vor dem Push
      COCKPIT.aufgaben = COCKPIT.aufgaben.filter(a => !/Session \+ Quiz/.test(a.titel));
      COCKPIT.fristen.push(Object.assign({ id: 'fx', faellig_am: iso, ganztags: true, status: 'offen', aufgabe_id: null }, f));
      semRefresh(); renderAufgaben();
      const dn = D14.fromIso(iso), on = ckKurse().filter(k => !state.aufgOff[k.id]), soon = ckSoon(on); exSoon(on, soon);
      return { cand: ckFristKandidaten().filter(x => /^ceo:/.test(x.marker)).map(x => x.marker), sem: SEM_EV.filter(x => x.dn === dn).map(x => x.was).sort(),
        dots: document.querySelectorAll(`#semb .semb-dot[data-dn="${dn}"]`).length, soon: soon.filter(o => D14.dn(o.dt.d.getFullYear(), o.dt.d.getMonth() + 1, o.dt.d.getDate()) === dn).map(o => o.dt.rest).sort() };
    }, [SOON[1], f]);
    ok(`${nm}: Push der Session ${push ? 'bleibt' : 'entfaellt'}`, r.cand.includes('ceo:' + SOON[1]) === push && r.cand.length === UP.length - (push ? 0 : 1), r.cand.length + '');
    ok(`${nm}: Leiste ein Punkt, Eintraege ${expSem.join(' + ')}`, r.dots === 1 && r.sem.join() === expSem.slice().sort().join(), r.sem.join(','));
    ok(`${nm}: Demnaechst ${expSoon.join(' + ')}`, r.soon.join() === expSoon.slice().sort().join(), r.soon.join(','));
    ok(`${nm}: keine Fehler`, !errs.length, errs.join(' | '));
    await ctx.close();
  }

  await browser.close();
  results.forEach(r => console.log(r[0], r[1], r[2] ? '— ' + String(r[2]).slice(0, 300) : ''));
  console.log(results.filter(r => r[0] === 'FAIL').length + ' FAIL / ' + results.length);
  process.exitCode = results.some(r => r[0] === 'FAIL') ? 1 : 0;
})();
