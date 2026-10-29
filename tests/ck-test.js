// Cockpit-Tests: node ck-test.js <base.html> <new.html> <shotDir> [mockPort=8787] [totPort=8799]
// Der Mock (cockpit-mock.js <mockPort> geheim-123) muss auf 127.0.0.1:<mockPort> laufen; auf <totPort> darf nichts lauschen
// (Test "Server nicht erreichbar"). base/new: Vorschau-Builds ohne CEO-Termine (tests/run.sh baut sie).
const { chromium } = require('playwright');
const path = require('path');
const [base, neu, out, portArg, deadArg] = process.argv.slice(2);
const PORT = +(portArg || 8787), DEAD = +(deadArg || 8799);
const MOCK = 'http://127.0.0.1:' + PORT;
require('fs').mkdirSync(out, { recursive: true });
const results = [];
const ok = (name, cond, info = '') => { results.push([cond ? 'OK  ' : 'FAIL', name, info]); };
const seedLocal = { MGTHN0189: [{ id: 'a1', t: '05.11.: Case Study entwerfen', d: false }, { id: 'a2', t: 'Folien lesen', d: true }], MGTHN0207: [{ id: 'b1', t: 'Übungsblatt 1', d: false }] };
async function ctxFor(browser, w, dark) {
  return browser.newContext({ viewport: { width: w, height: 844 }, isMobile: w < 800, hasTouch: w < 800, colorScheme: dark ? 'dark' : 'light', deviceScaleFactor: 2, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
}
async function open(ctx, file, ls) {
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });   // gewollte 401/500/Netzfehler sind kein Seitenfehler
  await page.goto('file://' + file); await page.waitForTimeout(300);
  await page.evaluate(([ls, seed]) => {
    localStorage.clear();
    const st = JSON.parse(localStorage.getItem('mmdt_blank_v1') || '{}');
    Object.keys(ls).forEach(k => localStorage.setItem(k, ls[k]));
    state.aufg = seed; save();
  }, [ls || {}, seedLocal]);
  await page.reload(); await page.waitForTimeout(900);
  return { page, errs };
}
const snap = page => page.evaluate(() => ['aufgaben', 'aufgaben-soon', 'aufgaben-off', 'semb', 'wochenplan'].map(id => document.getElementById(id).innerHTML.replace(/\s+/g, ' ')));
const overflow = page => page.evaluate(() => { const w = document.documentElement.clientWidth; return document.documentElement.scrollWidth > w ? document.documentElement.scrollWidth : 0; });
const mockLog = () => fetch(MOCK + '/__log').then(r => r.json());

(async () => {
  const browser = await chromium.launch();
  // 1) Regression ohne Token: gleiche To-do-/Semester-/Wochen-DOMs wie vorher, keine Fehler
  for (const [w, nm] of [[390, 'phone'], [1280, 'desktop']]) {
    const c1 = await ctxFor(browser, w), c2 = await ctxFor(browser, w);
    const a = await open(c1, base), b = await open(c2, neu);
    const sa = await snap(a.page), sb = await snap(b.page);
    ['aufgaben', 'aufgaben-soon', 'aufgaben-off', 'semb', 'wochenplan'].forEach((id, i) => ok(`ohne Token ${nm}: #${id} identisch`, sa[i] === sb[i], sa[i] === sb[i] ? '' : `len ${sa[i].length} vs ${sb[i].length}`));
    ok(`ohne Token ${nm}: keine Fehler`, !b.errs.length, b.errs.join(' | '));
    ok(`ohne Token ${nm}: td-meta sichtbar, ck-meta versteckt`, await b.page.evaluate(() => !document.getElementById('td-meta').hidden && document.getElementById('ck-meta').hidden));
    ok(`ohne Token ${nm}: Status "Nicht verbunden"`, (await b.page.textContent('#ck-status')).includes('Nicht verbunden'));
    for (const v of ['heute', 'fortschritt', 'kurse', 'planen']) {
      await b.page.evaluate(v => setView(v), v); await b.page.waitForTimeout(250);
      ok(`ohne Token ${nm}: Ansicht ${v} rendert ohne Ueberlauf`, (await overflow(b.page)) === 0 && !b.errs.length, b.errs.join(' | '));
    }
    const nreq = await b.page.evaluate(p => performance.getEntriesByType('resource').filter(e => new RegExp(p + '|supabase').test(e.name)).length, String(PORT));
    ok(`ohne Token ${nm}: keine Cockpit-Anfrage`, nreq === 0, String(nreq));
    await c1.close(); await c2.close();
  }

  // 2) Cockpit-Modus mit Mock
  const LS = { mmdt_cockpit_token: 'geheim-123', mmdt_cockpit_url: MOCK + '/mmdt', mmdt_cockpit_push: '0' };   // Fristen-Upload hier aus, eigener Test unten
  {
    const ctx = await ctxFor(browser, 1280); const { page, errs } = await open(ctx, neu, LS);
    await page.waitForFunction(() => window.COCKPIT && !document.getElementById('ck-meta').hidden, null, { timeout: 5000 });
    ok('Cockpit: ck-meta sichtbar', (await page.textContent('#ck-meta')).startsWith('Aus dem Cockpit · Stand'), await page.textContent('#ck-meta'));
    ok('Cockpit: lokale To-dos unsichtbar', !(await page.textContent('#aufgaben')).includes('Case Study entwerfen'));
    ok('Cockpit: lokale To-dos bleiben gespeichert', await page.evaluate(() => (state.aufg.MGTHN0189 || []).length === 2));
    const uni = await page.$$eval('[data-td-card="_uni"] .td-item', l => l.map(x => x.textContent.trim()));
    ok('Cockpit: Karte "Uni allgemein" mit 2 Aufgaben ohne Kurs', uni.length === 2 && (await page.textContent('[data-td-card="_uni"] .td-name')) === 'Uni allgemein', uni.join(' / '));
    ok('Cockpit: Karte MGTHN0189 zeigt Cockpit-Aufgabe + "1 erledigt"', (await page.textContent('[data-td-card="MGTHN0189"]')).includes('MR: Case Study 1 Gliederung') && (await page.textContent('[data-td-card="MGTHN0189"] .td-more')).includes('1 erledigt'));
    ok('Cockpit: ueberfaellige Aufgabe (MGTHN0207) mit rotem Chip', await page.$('[data-td-card="MGTHN0207"] .td-date.late') !== null);
    ok('Cockpit: Titel escaped (kein <b> aus Cockpit-Text)', await page.$('[data-td-card="MGTHN0111"] .td-text b') === null && (await page.textContent('[data-td-card="MGTHN0111"]')).includes('<b>Kap. 3</b>'));
    ok('Cockpit: Link ↗ nur http(s)', (await page.getAttribute('[data-td-card="MGTHN0111"] .ck-link', 'href')) === 'https://www.moodle.tum.de/');
    const tiles = await page.$$eval('.td-soon-tile', l => l.map(x => (x.classList.contains('frist') ? 'F:' : 'A:') + x.querySelector('.st-t').textContent));
    ok('Demnaechst: Aufgaben + Fristen (mit Art-Icon)', tiles.some(x => x.startsWith('F:')) && tiles.some(x => x.startsWith('A:')) && (await page.$$('.td-soon-tile.frist .st-ico')).length > 0, tiles.join(' | '));
    ok('Demnaechst: Frist > 21 Tage (Klausur +95) fehlt', !tiles.some(x => x.includes('Klausur GenAI Marketing')));
    ok('B8e: Frist mit aufgabe_id nicht doppelt', !tiles.some(x => x.includes('Abgabe Case Study 2')) && tiles.some(x => x.includes('MR: Case Study 1 Gliederung')));
    const dots = await page.$$eval('.semb-dot', l => l.length), ev = await page.evaluate(() => SEM_EV.map(x => x.dn - D14.today() + ':' + x.kurs + ':' + x.was));
    ok('Semester-Balken: Punkte aus Fristen, dedupliziert (5 statt 6)', dots === 5, ev.join(' | '));
    ok('Kalender aus COCKPIT', (await page.textContent('#now')).includes('COCKPIT') && await page.evaluate(() => GCAL.ev.some(e => e.t === 'COCKPIT Standup')));
    await page.evaluate(() => document.getElementById('open-settings').click()); await page.waitForTimeout(300);
    const st = await page.$eval('#ck-status', e => [e.className, e.textContent]);
    ok('Statuszeile verbunden (gruen, Zaehler, Kalender)', st[0].includes('ok') && new RegExp('5 offen \\(1 überfällig\\) · 5 Fristen · Kalender: 6 Termine · Server 127\\.0\\.0\\.1:' + PORT + ' · kein Supabase-Server').test(st[1]), st[1]);
    await page.screenshot({ path: path.join(out, 'desktop-settings-verbunden.png') });
    await page.evaluate(() => document.getElementById('close-settings').click());
    ok('Token nicht im state/Export', await page.evaluate(() => !JSON.stringify(state).includes('geheim') && !(localStorage.getItem('mmdt_blank_v1') || '').includes('geheim')));
    // Abhaken -> POST erledigt (optimistisch)
    const id = await page.getAttribute('[data-td-card="_uni"] .td-item:has-text("Bibliotheksausweis") input', 'data-ck-done');
    await page.click(`[data-ck-done="${id}"]`);
    const optimistic = await page.evaluate(id => COCKPIT.aufgaben.find(x => x.id === id).status, id);
    await page.waitForTimeout(500);
    let log = await mockLog();
    ok('Abhaken -> POST erledigt kommt an (optimistisch)', optimistic === 'erledigt' && log.some(b => b.aktion === 'erledigt' && b.id === id), JSON.stringify(log.slice(-1)));
    // wieder oeffnen
    await page.click('[data-td-card="_uni"] .td-more'); await page.waitForTimeout(150);
    await page.click(`[data-ck-done="${id}"]`); await page.waitForTimeout(500);
    log = await mockLog();
    ok('Wieder oeffnen -> POST offen', log.some(b => b.aktion === 'offen' && b.id === id));
    // Hinzufuegen mit Datum
    await page.fill('[data-ck-add="MGTHN0111"] input', '05.11. Gruppe treffen'); await page.press('[data-ck-add="MGTHN0111"] input', 'Enter');
    await page.waitForTimeout(600);
    log = await mockLog(); const neuB = log.filter(b => b.aktion === 'neu').pop() || {};
    ok('Hinzufuegen -> POST neu mit kurs/kursname/faellig (tdDate)', neuB.kurs === 'MGTHN0111' && neuB.faellig === '2026-11-05' && neuB.titel === 'Gruppe treffen' && !!neuB.kursname, JSON.stringify(neuB));
    ok('Neue Aufgabe erscheint in der Karte (Server-ID)', await page.evaluate(() => COCKPIT.aufgaben.some(x => x.titel === 'Gruppe treffen' && !/^tmp-/.test(x.id))) && (await page.textContent('[data-td-card="MGTHN0111"]')).includes('Gruppe treffen'));
    await page.fill('[data-ck-add="_uni"] input', 'Mensa-Karte aufladen'); await page.press('[data-ck-add="_uni"] input', 'Enter'); await page.waitForTimeout(500);
    log = await mockLog(); const neuU = log.filter(b => b.aktion === 'neu').pop() || {};
    ok('Hinzufuegen in "Uni allgemein" -> ohne kurs', neuU.titel === 'Mensa-Karte aufladen' && !('kurs' in neuU) && !('faellig' in neuU), JSON.stringify(neuU));
    // Fehler beim POST -> zurueck + Hinweis
    await fetch(MOCK + '/__fail?n=1');
    const id2 = await page.getAttribute('[data-td-card="MGTHN0189"] .td-item:has-text("Gliederung") input', 'data-ck-done');
    await page.click(`[data-ck-done="${id2}"]`); await page.waitForTimeout(500);
    ok('POST-Fehler -> zurueckgesetzt + Hinweis', await page.evaluate(id => COCKPIT.aufgaben.find(x => x.id === id).status === 'offen', id2) && (await page.textContent('#ck-meta')).includes('Nicht gespeichert') && !(await page.isChecked(`[data-ck-done="${id2}"]`)));
    await page.screenshot({ path: path.join(out, 'desktop-heute.png'), fullPage: true });
    ok('Cockpit desktop: keine Fehler / kein Ueberlauf', !errs.length && (await overflow(page)) === 0, errs.join(' | '));
    await ctx.close();
  }

  // 2b) Review-Befunde B1-B8
  {
    const ctx = await ctxFor(browser, 1280); const { page, errs } = await open(ctx, neu, LS);
    await page.waitForFunction(() => window.COCKPIT && !window.ckBusy, null, { timeout: 5000 }); await page.waitForTimeout(400);
    const idOf = async (card, txt) => page.getAttribute(`[data-td-card="${card}"] .td-item:has-text("${txt}") input`, 'data-ck-done');
    // B1: GET laeuft (alter Stand), POST erledigt wird waehrenddessen fertig -> Haken bleibt
    const idL = await idOf('_uni', 'Lerngruppe');
    await fetch(MOCK + '/__delay?what=get&ms=1500'); const g0 = (await (await fetch(MOCK + '/__gets')).json()).gets;
    await page.evaluate(() => { cockpitLoad(true); }); await page.waitForTimeout(200);
    await page.click(`[data-ck-done="${idL}"]`); await page.waitForTimeout(2500);
    const g1 = (await (await fetch(MOCK + '/__gets')).json()).gets;
    ok('B1: veraltetes GET verworfen, Haken bleibt, einmal neu geladen', await page.evaluate(id => COCKPIT.aufgaben.find(x => x.id === id).status === 'erledigt', idL)
      && (await page.textContent('[data-td-card="_uni"] .td-more')).includes('1 erledigt') && g1 - g0 === 2, `GETs ${g1 - g0}`);
    // B2: Hinzufuegen schlaegt fehl -> Text bleibt im Feld
    await fetch(MOCK + '/__fail?n=1');
    await page.fill('[data-ck-add="MGTHN0207"] input', 'Wichtiger Entwurf'); await page.press('[data-ck-add="MGTHN0207"] input', 'Enter'); await page.waitForTimeout(600);
    ok('B2: fehlgeschlagenes Hinzufuegen behaelt Text', (await page.inputValue('[data-ck-add="MGTHN0207"] input')) === 'Wichtiger Entwurf');
    ok('B8d: POST-Fehler setzt ckErr net', await page.evaluate(() => !!(ckErr && ckErr.kind === 'net')));
    await page.fill('[data-ck-add="MGTHN0207"] input', '');
    // B3: Karte ohne Modulcode -> Hinweis statt Formular
    await page.evaluate(() => { state.cust.push({ id: 'X-test', t: 'Eigener Kurs', c: 5, cat: 'mgmt_other' }); state.picked['X-test'] = state.cursem; injectCustomMods(); renderAufgaben(); });
    ok('B3: Karte ohne Modulcode zeigt Hinweis statt Formular', !!(await page.$('[data-td-card="X-test"] .ck-noadd')) && !(await page.$('[data-ck-add="X-test"]')), await page.textContent('[data-td-card="X-test"] .ck-noadd').catch(() => ''));
    await page.evaluate(() => { state.cust = state.cust.filter(c => c.id !== 'X-test'); delete state.picked['X-test']; injectCustomMods(); save(); });
    // B4: Reload waehrend getippt wird -> Text + Fokus bleiben, Daten trotzdem neu
    await page.waitForTimeout(400);
    await page.click('[data-ck-add="MGTHN0130"] input'); await page.keyboard.type('halb get');
    const st0 = await page.evaluate(() => COCKPIT.stand);
    await page.evaluate(() => cockpitLoad(true)); await page.waitForTimeout(800);
    const foc = await page.evaluate(() => document.activeElement && document.activeElement.closest('[data-ck-add]') ? document.activeElement.closest('[data-ck-add]').dataset.ckAdd + '|' + document.activeElement.value : '');
    ok('B4: Reload beim Tippen behaelt Fokus + Text, Datenmodell neu', foc === 'MGTHN0130|halb get' && (await page.evaluate(() => COCKPIT.stand)) !== st0 && await page.evaluate(() => ckDeferred), foc);
    await page.evaluate(() => document.activeElement.blur()); await page.waitForTimeout(200);
    ok('B4: nach Verlassen neu gezeichnet, Entwurf bleibt', !(await page.evaluate(() => ckDeferred)) && (await page.inputValue('[data-ck-add="MGTHN0130"] input')) === 'halb get');
    await page.fill('[data-ck-add="MGTHN0130"] input', '');
    // B8b: Titel aus Datum/Uhrzeit
    for (const [txt, want, due] of [['03.11. 15:00–17:30: Folien', '15:00–17:30 Folien', '2026-11-03'], ['28.10. 09:00', '28.10. 09:00', '2026-10-28']]) {
      await page.fill('[data-ck-add="MGTHN0189"] input', txt); await page.press('[data-ck-add="MGTHN0189"] input', 'Enter'); await page.waitForTimeout(500);
      const b = (await mockLog()).filter(x => x.aktion === 'neu').pop();
      ok(`B8b: "${txt}" -> Titel "${want}"`, b.titel === want && b.faellig === due, JSON.stringify(b));
    }
    // B8c: Token entfernt waehrend POST -> kein Fehler
    const idB = await idOf('_uni', 'Bibliotheksausweis');
    await fetch(MOCK + '/__delay?what=post&ms=800');
    await page.click(`[data-ck-done="${idB}"]`);
    await page.evaluate(() => { const i = document.getElementById('ck-token'); i.value = ''; i.dispatchEvent(new Event('change')); });
    await page.waitForTimeout(1200);
    ok('B8c: Token waehrend POST entfernt -> kein Fehler, lokal', !errs.length && !(await page.evaluate(() => !!window.COCKPIT)), errs.join(' | '));
    // B5: Tokenwechsel waehrend GET -> neuer Abruf ohne 10-Min-Warten
    await page.evaluate(() => { const i = document.getElementById('ck-token'); i.value = 'geheim-123'; i.dispatchEvent(new Event('change')); });
    await page.waitForFunction(() => window.COCKPIT, null, { timeout: 5000 }); await page.waitForTimeout(300);
    await fetch(MOCK + '/__delay?what=get&ms=1200');
    await page.evaluate(() => cockpitLoad(true)); await page.waitForTimeout(150);
    await page.evaluate(() => { const i = document.getElementById('ck-token'); i.value = 'falsch'; i.dispatchEvent(new Event('change')); });
    await page.waitForTimeout(2200);
    ok('B5: Tokenwechsel waehrend GET -> sofort neu geladen (401)', (await page.textContent('#ck-status')).startsWith('Token abgelehnt'), await page.textContent('#ck-status'));
    // B6: URL-Pruefung, Host, Cache-Leerung
    await page.evaluate(() => { const i = document.getElementById('ck-token'); i.value = 'geheim-123'; i.dispatchEvent(new Event('change')); });
    await page.waitForFunction(() => window.COCKPIT && localStorage.getItem('mmdt_cockpit_cache'), null, { timeout: 5000 });
    await page.evaluate(() => { const i = document.getElementById('ck-url'); i.value = 'http://example.com/mmdt'; i.dispatchEvent(new Event('change')); });
    ok('B6: http:// fremder Host abgelehnt', (await page.$eval('#ck-status', e => e.className + '|' + e.textContent)).includes('err|Die Adresse muss mit https://') && (await page.evaluate(() => ckUrl())) === MOCK + '/mmdt');
    await page.evaluate(() => { const i = document.getElementById('ck-url'); i.value = 'https://127.0.0.1:9/mmdt'; i.dispatchEvent(new Event('change')); });
    const cacheGone = await page.evaluate(() => localStorage.getItem('mmdt_cockpit_cache') === null);
    await page.waitForTimeout(800);
    const st = await page.textContent('#ck-status');
    ok('B6: URL-Wechsel leert Cache, Status zeigt Host + Warnung', cacheGone && st.includes('Server 127.0.0.1:9') && st.includes('kein Supabase-Server'), st);
    ok('B6: localhost http erlaubt, Default ist supabase', await page.evaluate(() => ckUrlOk('http://localhost:8080/x') && ckUrlOk('http://[::1]/x') && !ckUrlOk('http://pi:8080/x') && !ckUrlOk('javascript:alert(1)')));
    ok('2b: keine Fehler', !errs.length, errs.join(' | '));
    await ctx.close();
  }

  // 2c) Fristen-Upload: 2 TUM-Pruefungen + 1 eigene Deadline -> 3 POST frist; zweiter Lauf 0; Schalter aus 0; Vergangenes/Abgemeldetes nie
  {
    const fs = require('fs'), de = k => { const d = new Date(); d.setDate(d.getDate() + k); return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`; };
    const isoK = k => { const d = new Date(); d.setDate(d.getDate() + k); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    const html = fs.readFileSync(neu, 'utf8'), ex = { MGTHN0207: de(110), MGTHN0189: de(40), MGTHN0130: de(-3), MGTHN0113: de(50) };
    if (!/"examDates": \{[^}]*\}/.test(html)) throw new Error('examDates nicht gefunden');
    const pushFile = path.join(path.dirname(neu), 'new-push.html');
    fs.writeFileSync(pushFile, html.replace(/"examDates": \{[^}]*\}/, '"examDates": ' + JSON.stringify(ex)));
    const seed = async (page, ls) => {
      await page.evaluate(([ls, d1, d2]) => {
        localStorage.clear(); Object.keys(ls).forEach(k => localStorage.setItem(k, ls[k]));
        state.cs.MGTHN0113 = { s: 'abgemeldet', g: '' };
        state.dl.custom = [{ id: 'd1', title: 'Abgabe Essay MGTHN0111', date: d1, time: '23:59', type: 'info', action: '' }, { id: 'd2', title: 'Alte Abgabe', date: d2, time: '', type: 'info', action: '' }];
        save();
      }, [ls, isoK(20), isoK(-1)]);
      await page.reload();
    };
    const fristPosts = async () => (await mockLog()).filter(b => b.aktion === 'frist');
    const LSP = { mmdt_cockpit_token: 'geheim-123', mmdt_cockpit_url: MOCK + '/mmdt' };
    const ctx = await ctxFor(browser, 1280); const page = await ctx.newPage(); const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto('file://' + pushFile); await page.waitForTimeout(300);
    const before = (await fristPosts()).length;
    await seed(page, LSP);
    await page.waitForFunction(() => window.COCKPIT, null, { timeout: 5000 });
    const g0 = (await (await fetch(MOCK + '/__gets')).json()).gets;
    await page.waitForTimeout(3500);
    const sent = (await fristPosts()).slice(before), markers = sent.map(b => b.quelle_marker).sort();
    ok('Upload: erster Lauf 3 POST frist (2 TUM-Pruefungen + 1 Deadline)', sent.length === 3 && markers.join(',') === 'dl:d1,tum-exam-MGTHN0189,tum-exam-MGTHN0207', markers.join(','));
    const d1 = sent.find(b => b.quelle_marker === 'dl:d1') || {}, ex1 = sent.find(b => b.quelle_marker === 'tum-exam-MGTHN0189') || {};
    ok('Upload: Felder nach Vertrag', ex1.art === 'pruefung' && ex1.kurs === 'MGTHN0189' && ex1.ganztags === true && /^\d{4}-\d{2}-\d{2}$/.test(ex1.faellig_am) && ex1.link === 'https://campus.tum.de' && ex1.aufgabe === true
      && d1.art === 'abgabe' && d1.kurs === 'MGTHN0111' && /T23:59:00\+0[12]:00$/.test(d1.faellig_am) && d1.ganztags === false, JSON.stringify(ex1) + ' ' + JSON.stringify(d1));
    ok('Upload: vergangene Frist + abgemeldeter Kurs nicht gesendet', !sent.some(b => /MGTHN0130|MGTHN0113|dl:d2/.test(b.quelle_marker)));
    const st = await page.textContent('#ck-status'), g1 = (await (await fetch(MOCK + '/__gets')).json()).gets;
    ok('Upload: Statuszeile "3 Fristen übertragen"', st.includes('3 Fristen übertragen'), st);
    ok('Upload: Modell sofort aktualisiert (ohne GET), Demnaechst zeigt neue Aufgabe', g1 === g0 && await page.evaluate(() => COCKPIT.fristen.filter(f => f.aufgabe_id).length >= 3)
      && await page.evaluate(() => ckSoon(ckKurse().filter(k => !state.aufgOff[k.id])).some(o => o.dt.rest === 'Abgabe Essay MGTHN0111' && !o.ico)), `GETs ${g1 - g0}`);   // als Aufgabe (Frist per aufgabe_id nicht doppelt)
    const dots = await page.evaluate(() => SEM_EV.filter(x => x.code === 'MGTHN0189' && x.was.startsWith('Prüfung')).length);
    ok('Upload: TUM-Pruefung als Punkt im Semester-Balken, nur einmal', dots === 1, String(dots));
    ok('Upload: Merkliste gesetzt', await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('mmdt_cockpit_pushed'))).length === 3));
    await page.reload(); await page.waitForFunction(() => window.COCKPIT, null, { timeout: 5000 }); await page.waitForTimeout(3500);
    ok('Upload: zweiter Lauf 0 POST', (await fristPosts()).length === before + 3);
    // Schalter aus (frische Merkliste) -> 0
    await seed(page, Object.assign({ mmdt_cockpit_push: '0' }, LSP));
    await page.waitForFunction(() => window.COCKPIT, null, { timeout: 5000 }); await page.waitForTimeout(3500);
    ok('Upload: Schalter aus -> 0 POST', (await fristPosts()).length === before + 3 && !(await page.isChecked('#ck-push')));
    await page.evaluate(() => { const c = document.getElementById('ck-push'); c.checked = true; c.dispatchEvent(new Event('change')); });
    await page.waitForTimeout(3000);
    ok('Upload: Schalter wieder an -> Lauf, Server dedupliziert (neu:false)', (await fristPosts()).length === before + 6 && await page.evaluate(() => localStorage.getItem('mmdt_cockpit_push') === null));
    ok('Upload: keine Fehler', !errs.length, errs.join(' | '));
    await ctx.close();
  }
  // B7: ganztaegige Frist in Europe/Berlin, auch wenn der Browser in New York laeuft
  {
    const ctx = await browser.newContext({ timezoneId: 'America/New_York' }); const page = await ctx.newPage();
    await page.goto('file://' + neu); await page.waitForTimeout(400);
    const r = await page.evaluate(() => [D14.toIso(ckWhen('2026-11-05T23:00:00+00:00', true).dn), D14.toIso(ckWhen('2026-11-05T23:30:00+00:00', false).dn)]);
    ok('B7: ganztags 05.11. 23:00Z = 06.11. Berlin (Browser New York)', r[0] === '2026-11-06' && r[1] === '2026-11-05', r.join(' / '));
    await ctx.close();
  }
  // 3) Phone hell/dunkel
  for (const dark of [false, true]) {
    const ctx = await ctxFor(browser, 390, dark); const { page, errs } = await open(ctx, neu, LS);
    await page.waitForFunction(() => window.COCKPIT, null, { timeout: 5000 }); await page.waitForTimeout(300);
    const tag = dark ? 'phone-dark' : 'phone';
    ok(`${tag}: kein horizontaler Ueberlauf (Heute)`, (await overflow(page)) === 0);
    ok(`${tag}: Faltung leerer Karten aktiv`, (await page.$('#aufgaben details.td-fold')) !== null);
    await page.screenshot({ path: path.join(out, `${tag}-heute.png`), fullPage: true });
    await page.evaluate(() => document.getElementById('open-settings').click()); await page.waitForTimeout(400);
    await page.evaluate(() => document.getElementById('ck-set').scrollIntoView());
    ok(`${tag}: Sheet ohne Ueberlauf`, await page.evaluate(() => { const s = document.querySelector('#settings-dlg .sheet-in'); return s.scrollWidth <= s.clientWidth + 1; }));
    await page.screenshot({ path: path.join(out, `${tag}-settings.png`) });
    for (const v of ['fortschritt', 'kurse', 'planen']) { await page.evaluate(() => document.getElementById('close-settings').click()); await page.evaluate(v => setView(v), v); await page.waitForTimeout(200); ok(`${tag}: Ansicht ${v} ohne Ueberlauf`, (await overflow(page)) === 0); }
    ok(`${tag}: keine Fehler`, !errs.length, errs.join(' | '));
    await ctx.close();
  }
  // 4) 401 -> rot, lokaler Modus
  {
    const ctx = await ctxFor(browser, 390); const { page, errs } = await open(ctx, neu, { mmdt_cockpit_token: 'falsch', mmdt_cockpit_url: MOCK + '/mmdt' });
    await page.waitForFunction(() => document.getElementById('ck-status').className.includes('err'), null, { timeout: 5000 });
    const st = await page.$eval('#ck-status', e => [e.className, e.textContent]);
    ok('401 -> Statuszeile rot "Token abgelehnt", lokaler Modus', st[1].includes('Token abgelehnt') && !(await page.evaluate(() => !!window.COCKPIT)) && (await page.textContent('#aufgaben')).includes('Case Study entwerfen'), st.join(' / '));
    await page.evaluate(() => document.getElementById('open-settings').click()); await page.waitForTimeout(300);
    await page.evaluate(() => document.getElementById('ck-set').scrollIntoView());
    await page.screenshot({ path: path.join(out, 'phone-settings-401.png') });
    ok('401: keine Fehler', !errs.length, errs.join(' | '));
    await ctx.close();
  }
  // 5) Mock nicht erreichbar -> Cache
  {
    const ctx = await ctxFor(browser, 390); const { page } = await open(ctx, neu, LS);
    await page.waitForFunction(() => window.COCKPIT, null, { timeout: 5000 }); await page.waitForTimeout(300);
    await page.evaluate(u => localStorage.setItem('mmdt_cockpit_url', u), 'http://127.0.0.1:' + DEAD + '/mmdt');   // dort laeuft nichts
    await page.reload();
    await page.waitForFunction(() => document.getElementById('ck-meta').textContent.startsWith('Offline'), null, { timeout: 5000 });
    ok('Netzfehler -> Cache genutzt, Hinweis "Offline · Stand" in der Kopfzeile', (await page.textContent('#aufgaben')).includes('Gruppe treffen') && (await page.textContent('#ck-meta')).startsWith('Offline · Stand'), await page.textContent('#ck-meta'));
    ok('Netzfehler -> Statuszeile nennt Fehler + Stand', (await page.textContent('#ck-status')).includes('Keine Verbindung (Server nicht erreichbar) · zeige Stand'), await page.textContent('#ck-status'));
    await page.screenshot({ path: path.join(out, 'phone-offline-cache.png'), fullPage: false });
    // Token entfernen -> wieder lokal
    await page.evaluate(() => { const i = document.getElementById('ck-token'); i.value = ''; i.dispatchEvent(new Event('change')); });
    await page.waitForTimeout(300);
    ok('Token leeren -> lokaler Modus, Cache geloescht', !(await page.evaluate(() => !!window.COCKPIT)) && (await page.textContent('#aufgaben')).includes('Case Study entwerfen') && await page.evaluate(() => localStorage.getItem('mmdt_cockpit_cache') === null));
    await ctx.close();
  }
  await browser.close();
  results.forEach(r => console.log(r[0], r[1], r[2] ? '— ' + String(r[2]).slice(0, 300) : ''));
  console.log(results.filter(r => r[0] === 'FAIL').length + ' FAIL / ' + results.length);
  process.exitCode = results.some(r => r[0] === 'FAIL') ? 1 : 0;
})();
