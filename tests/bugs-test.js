// v22 Bug-Fixes: node bugs-test.js <buildDir> <shotDir> <repoRoot>
//   buildDir: new.html, base-noceo.html (alter Stand, nur fuer "alter Client"), v22-crash.html, v22-sose.html (Stand 10.05.2027), v22-xss.html
//   Optional: PAGES_FN=/pfad/zu/functions/api/mmdt-state.js -> Pages-Function (Cloudflare) mit Mock-KV pruefen (sonst SKIP)
// Prueft: (1) ungueltige Termine/Teilfehler legen die App nicht lahm, (2) Geraete-Sync fuehrt zusammen (serve.py, alter Server,
// alter Client, Pages-Function), (3) kein gespeichertes XSS (alle Ansichten, Import, Sync), (4) Semester dynamisch (WS heute, SoSe,
// Fallback ohne Build), (5) eigene Semester-Wahl bleibt, (6) siehe tests/py-test.py, (7) Handy-Felder >= 16px, (8) Import zeichnet
// alles neu, (9) Labels/Tastatur, (10) lange Woerter auf 320px, (11) Specialization-Text je Sprache. Nur erfundene Daten.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http');
const net = require('net');
const path = require('path');
const fs = require('fs');
const os = require('os');
const [B, out, ROOT] = process.argv.slice(2).map(x => path.resolve(x));
fs.mkdirSync(out, { recursive: true });
const NEW = path.join(B, 'new.html'), OLD = path.join(B, 'base-noceo.html'), CRASH = path.join(B, 'v22-crash.html'), SOSE = path.join(B, 'v22-sose.html'), XSS = path.join(B, 'v22-xss.html');
const TEMPLATE = path.join(ROOT, 'template.html');
const results = [];
const ok = (name, cond, info = '') => results.push([cond ? 'OK  ' : 'FAIL', name, info]);
const skip = (name, why) => results.push(['SKIP', name, why]);
const FIXED = new Date(); FIXED.setSeconds(0, 0);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 6000) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return v; await sleep(100); } }
const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

async function open(browser, file, { w = 390, h = 844, scheme = 'light', style = null, ls = null, clock = FIXED, lang = null, keep = false, url = null, ctx = null } = {}) {
  const c = ctx || await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 800, hasTouch: w < 800, colorScheme: scheme,
    deviceScaleFactor: w < 800 ? 2 : 1, locale: 'de-DE', timezoneId: 'Europe/Berlin', acceptDownloads: true });
  const p = await c.newPage(); const errs = [], warns = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); if (m.type() === 'warning') warns.push(m.text()); });
  p.on('dialog', d => d.accept());
  if (clock) await p.clock.setFixedTime(clock);
  await p.goto(url || 'file://' + file); await p.waitForTimeout(200);
  if (!keep) {
    await p.evaluate(([ls, st, lang]) => { localStorage.clear(); if (st) localStorage.setItem('mmdt_style', st); Object.keys(ls || {}).forEach(k => localStorage.setItem(k, ls[k]));
      if (lang) { const s = JSON.parse(localStorage.getItem('mmdt_blank_v1') || '{}'); s.lang = lang; localStorage.setItem('mmdt_blank_v1', JSON.stringify(s)); } }, [ls, style, lang]);
    await p.reload(); await p.waitForTimeout(600);
  }
  return { ctx: c, p, errs, warns };
}
const go = (p, v, s) => p.evaluate(([v, s]) => { setView(v); if (s) document.querySelector(`#subnav [data-sub="${s}"]`).click(); window.scrollTo(0, 0); }, [v, s]).then(() => p.waitForTimeout(250));
const over = p => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const setSem = (p, v) => p.evaluate(v => { const s = document.getElementById('cursem'); s.value = v; s.dispatchEvent(new Event('change')); }, v);   // Feld liegt im (geschlossenen) Einstellungs-Sheet
const VIEWS = [['heute'], ['fortschritt'], ['kurse'], ['planen', 'pfad'], ['planen', 'module'], ['planen', 'kalender']];

(async () => {
  const browser = await chromium.launch();

  // ================================================================ (1) Ungueltige Termine, Teilfehler
  console.error("# (1) Ungueltige Termine, Teilfehler");
  {
    const { ctx, p, errs, warns } = await open(browser, CRASH);
    const r = await p.evaluate(() => {
      const ev = SKAL.EVENTS.filter(e => e.code === 'MGTHN0189');
      const mid = ev.find(e => e.start === 1080);
      return { skal: !!window.SKAL, on: [...document.querySelectorAll('.view.on')].length, n: ev.length, mid: mid ? mid.end : null,
        bad: ev.some(e => e.start === 1200), strat: [...stratEvents('MGTHN0189').map.values()].flat().some(x => x[0] === 1080 && x[1] === 1440) };
    });
    ok('Termine: "18:00-00:00" und kaputte Termine -> App laeuft (Kalender da, Ansicht an)', r.skal && r.on === 1 && !errs.length, errs.join(' | '));
    ok('Termine: Ende 00:00 = 24:00 (1440) in Kalender und Wochenraster', r.mid === 1440 && r.strat, JSON.stringify(r));
    ok('Termine: Ende vor Beginn / falsches Format / 31.02. uebersprungen + console.warn', !r.bad && r.n === 15 && warns.filter(w => /ungültiger Termin/.test(w)).length >= 3, `${r.n} Termine, ${warns.length} Warnungen`);
    await p.click('#bnav [data-view="kurse"]'); await p.waitForTimeout(150);
    ok('Termine: Navigation funktioniert', await p.evaluate(() => document.querySelector('.view.on').dataset.view === 'kurse'));
    await p.evaluate(() => { setView('planen', 'kalender'); document.querySelector('[data-skal-view="week"]').click(); });
    ok('Termine: Woche mit Termin bis Mitternacht ohne Fehler', !errs.length, errs.join(' | '));
    // eine Ansicht wirft -> die anderen zeichnen trotzdem
    const e2 = [];
    p.on('console', m => { if (m.type() === 'error') e2.push(m.text()); });
    const r2 = await p.evaluate(() => {
      window.renderPruefungen = () => { throw new Error('Testfehler'); };
      document.getElementById('wochenplan').innerHTML = ''; document.getElementById('aufgaben').innerHTML = '';
      renderAll();
      return { wp: document.getElementById('wochenplan').innerHTML.length, td: document.getElementById('aufgaben').innerHTML.length };
    });
    ok('Teilfehler: eine Ansicht wirft -> Rest wird gezeichnet, Fehler geloggt', r2.wp > 100 && r2.td > 100 && e2.some(x => /renderPruefungen/.test(x)), JSON.stringify(r2) + ' ' + e2.join(' | '));
    await ctx.close();
  }
  {   // Kalender selbst wirft beim Start (Element fehlt) -> Rest der App laeuft
    const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await c.addInitScript(() => document.addEventListener('DOMContentLoaded', () => { const m = document.getElementById('skal-meta'); if (m) m.remove(); }));
    const p = await c.newPage(); const errs = [];
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    p.on('pageerror', e => errs.push('pageerror ' + e.message));
    await p.clock.setFixedTime(FIXED);
    await p.goto('file://' + NEW); await p.waitForTimeout(600);
    const r = await p.evaluate(() => ({ skal: window.SKAL, on: document.querySelectorAll('.view.on').length, wp: document.getElementById('wochenplan').innerHTML.length, semb: document.getElementById('semb').innerHTML.length }));
    await p.click('#bnav [data-view="planen"]'); await p.waitForTimeout(150);
    ok('Init: createSkal wirft -> Ansichten, Wochenplan, Semesterleiste trotzdem da', r.skal === null && r.on === 1 && r.wp > 100 && r.semb > 100
      && await p.evaluate(() => document.querySelector('.view.on').dataset.view === 'planen') && errs.some(x => /Kalender fehlgeschlagen/.test(x)) && !errs.some(x => /^pageerror/.test(x)), errs.join(' | ').slice(0, 200));
    await c.close();
  }

  // ================================================================ (2) Geraete-Sync
  console.error("# (2) Geraete-Sync");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmdt-sync-'));
  fs.copyFileSync(NEW, path.join(dir, 'dashboard.html'));
  const port = await freePort();
  const srv = spawn('python3', [path.join(ROOT, 'scripts', 'serve.py'), '--port', String(port), '--bind', '127.0.0.1', '--dir', dir], { stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`, file = path.join(dir, 'mmdt-state.json');
  await until(() => fetch(base + '/api/mmdt-state').then(r => r.ok).catch(() => false), 8000);
  const srvState = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return { ts: 0, state: null }; } };
  const todos = st => ((st && st.aufg && st.aufg.MGTHN0189) || []).map(x => x.t).sort().join(',');
  const addTodo = (p, txt) => p.fill('[data-td-add="MGTHN0189"] input', txt).then(() => p.press('[data-td-add="MGTHN0189"] input', 'Enter'));
  try {
    const A = await open(browser, null, { url: base + '/dashboard.html', w: 390, keep: true, clock: null });
    const Bp = await open(browser, null, { url: base + '/dashboard.html', w: 1280, h: 900, keep: true, clock: null });
    await sleep(1200);
    // h2: Handy legt To-do an, Mac-Tab (offen, veraltet) aendert die Notiz
    await addTodo(A.p, 'Handy-Todo');
    await until(() => todos(srvState().state) === 'Handy-Todo');
    await Bp.p.evaluate(() => { state.notiz = 'Mac-Notiz'; save(); });
    const s1 = await until(() => { const s = srvState().state; return s && s.notiz === 'Mac-Notiz' && s; });
    ok('Sync (h2): veralteter Tab ueberschreibt nicht – To-do vom Handy + Notiz vom Mac auf dem Server', s1 && todos(s1) === 'Handy-Todo' && s1.notiz === 'Mac-Notiz', JSON.stringify(s1 && s1.aufg));
    ok('Sync: Mac-Tab hat das Handy-To-do uebernommen (ohne Reload)', await Bp.p.evaluate(() => (state.aufg.MGTHN0189 || []).some(x => x.t === 'Handy-Todo')
      && !!document.querySelector('[data-td-card="MGTHN0189"] .td-text')));
    // Loeschen am Handy (veraltet), Mac legt parallel etwas an -> Geloeschtes kommt nicht zurueck
    await Bp.p.evaluate(() => { state.aufg.MGTHN0189.push({ id: 'macTodo1', t: 'Mac-Todo', d: false, p: 0 }); save(); });
    await until(() => todos(srvState().state) === 'Handy-Todo,Mac-Todo');
    await A.p.evaluate(() => { const l = state.aufg.MGTHN0189; state.aufg.MGTHN0189 = l.filter(x => x.t !== 'Handy-Todo'); save(); renderAufgaben(); });
    await until(() => todos(srvState().state) === 'Mac-Todo');
    await Bp.p.evaluate(() => { state.notiz = 'Mac-Notiz 2'; save(); });
    const s2 = await until(() => { const s = srvState().state; return s && s.notiz === 'Mac-Notiz 2' && s; });
    ok('Sync: geloeschtes To-do bleibt geloescht, paralleles To-do bleibt (Grabstein / 3-Wege)', s2 && todos(s2) === 'Mac-Todo' && !!s2._del && Object.keys(s2._del).some(k => /^aufg:MGTHN0189\|/.test(k)), s2 && todos(s2));
    ok('Sync: Mac-Tab sieht die Loeschung', await Bp.p.evaluate(() => (state.aufg.MGTHN0189 || []).map(x => x.t).join(',')) === 'Mac-Todo');
    // Einstellungen: beide aendern verschiedene Felder; gleiches Feld -> neuere Aenderung gewinnt
    await A.p.evaluate(() => { state.spec = 'family'; state.notiz = 'Handy-Notiz alt'; save(); });
    await sleep(150);
    await Bp.p.evaluate(() => { state.lang = 'en'; state.notiz = 'Mac-Notiz neu'; save(); });
    const s3 = await until(() => { const s = srvState().state; return s && s.spec === 'family' && s.lang === 'en' && s.notiz.includes('Mac-Notiz neu') && s.notiz.includes('Handy-Notiz alt') && s; }, 8000);
    ok('Sync: verschiedene Einstellungen beider Geraete bleiben; Notiz von beiden geaendert -> beide Fassungen bleiben (v22)', !!s3 && /--- Konflikt/.test(s3.notiz), JSON.stringify(srvState().state && [srvState().state.spec, srvState().state.lang, srvState().state.notiz]));
    // gleicher Eintrag auf beiden geaendert -> neuerer _t gewinnt
    await A.p.evaluate(() => { const x = state.aufg.MGTHN0189.find(y => y.id === 'macTodo1'); x.d = true; save(); });
    await sleep(150);
    await Bp.p.evaluate(() => { const x = state.aufg.MGTHN0189.find(y => y.id === 'macTodo1'); x.p = 3; save(); });
    const s4 = await until(() => { const s = srvState().state, x = s && (s.aufg.MGTHN0189 || [])[0]; return x && x.p === 3 && x.d && x; }, 8000);
    ok('Sync: gleicher Eintrag beidseitig geaendert -> feldweise (abgehakt von A + Prioritaet von B)', s4 && s4.p === 3 && s4.d === true && s4._t > 0, JSON.stringify(s4));
    await sleep(1500);
    await A.p.reload(); await A.p.waitForTimeout(1500);
    const a5 = await A.p.evaluate(() => ({ t: (state.aufg.MGTHN0189 || []).map(x => x.t + ':' + x.p).join(','), n: state.notiz, lang: state.lang, base: SYNC.base, ta: document.getElementById('note-text').value }));
    ok('Sync: Handy nach Reload = Serverstand (To-dos, Notiz im Feld, Sprache), base = Server-ts', a5.t === 'Mac-Todo:3' && a5.n === srvState().state.notiz && a5.ta === a5.n && a5.n.includes('Mac-Notiz neu') && a5.lang === 'en' && a5.base === srvState().ts, JSON.stringify(a5));
    ok('Sync: keine Fehler in beiden Tabs', !A.errs.length && !Bp.errs.length, A.errs.concat(Bp.errs).join(' | '));
    await A.ctx.close(); await Bp.ctx.close();

    // Protokoll direkt: alter Client (ohne base) und neuer (mit base)
    const put = body => fetch(base + '/api/mmdt-state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, j: await r.json() }));
    const cur = srvState();
    let r = await put({ ts: cur.ts - 1000, state: { notiz: 'alt' } });
    ok('Protokoll alt (ohne base): aelterer ts wird nicht gespeichert (200, stored false)', r.status === 200 && r.j.ok && r.j.stored === false && srvState().state.notiz === cur.state.notiz, JSON.stringify(r));
    r = await put({ ts: 1, base: cur.ts - 5, state: { notiz: 'veraltet' } });
    ok('Protokoll v22: veraltete base -> 409 mit aktuellem {ts, state}', r.status === 409 && r.j.ts === cur.ts && r.j.state && r.j.state.notiz === cur.state.notiz && srvState().state.notiz === cur.state.notiz, JSON.stringify(r).slice(0, 120));
    r = await put({ ts: 1, base: cur.ts, state: Object.assign({}, cur.state, { notiz: 'mit base' }) });
    ok('Protokoll v22: passende base -> gespeichert, neuer ts > alter ts', r.status === 200 && r.j.stored === true && r.j.ts > cur.ts && srvState().state.notiz === 'mit base', JSON.stringify(r));
    r = await put({ ts: 1, base: 'x', state: {} });
    ok('Protokoll v22: base kein Zahlwert -> 400', r.status === 400, JSON.stringify(r));
    // alter Client (Stand vor v22) gegen den neuen Server
    fs.copyFileSync(OLD, path.join(dir, 'alt.html'));
    const O = await open(browser, null, { url: base + '/alt.html', keep: true, clock: null }); await sleep(1500);
    await O.p.evaluate(() => { state.notiz = 'alter Client'; save(); });
    ok('Kompatibel: alter Client (ohne base) speichert weiter auf dem neuen Server', !!await until(() => srvState().state.notiz === 'alter Client'));
    await O.ctx.close();
  } finally { srv.kill(); }

  // ---------------------------------------------------------------- (2b) v22-Nachbesserung: Sync-Feinheiten (je Fall eigener serve.py)
  console.error('# (2b) Sync-Feinheiten');
  const procs = [];
  process.on('exit', () => procs.forEach(x => { try { x.kill(); } catch (e) {} }));
  async function senv(serverFile) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mmdt-sync2-'));
    fs.copyFileSync(NEW, path.join(d, 'dashboard.html'));
    if (serverFile) fs.writeFileSync(path.join(d, 'mmdt-state.json'), JSON.stringify(serverFile));
    const pt = await freePort();
    const pr = spawn('python3', [path.join(ROOT, 'scripts', 'serve.py'), '--port', String(pt), '--bind', '127.0.0.1', '--dir', d], { stdio: 'ignore' }); procs.push(pr);
    const url = `http://127.0.0.1:${pt}`;
    await until(() => fetch(url + '/api/mmdt-state').then(r => r.ok).catch(() => false), 8000);
    const ctxs = [];
    return { url, ctxs, srv: () => { try { return JSON.parse(fs.readFileSync(path.join(d, 'mmdt-state.json'), 'utf8')).state || {}; } catch (e) { return {}; } },
      file: path.join(d, 'mmdt-state.json'),
      async dev({ ctx = null, skew = 0, seed = null, noDate = false } = {}) {
        const c = ctx || await browser.newContext({ viewport: { width: 1000, height: 800 }, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
        if (!ctx) {
          ctxs.push(c);
          await c.addInitScript(off => { const D = Date; window.__skew = off; class FD extends D { constructor(...a) { if (!a.length) super(D.now() + window.__skew); else super(...a); } static now() { return D.now() + window.__skew; } } window.Date = FD; }, skew);
          if (noDate) await c.route('**/api/mmdt-state', async r => { const resp = await r.fetch(); const h = Object.assign({}, resp.headers()); delete h.date; await r.fulfill({ response: resp, headers: h }); });   // Server ohne Date-Header
          if (seed) await c.addInitScript(st => { if (!localStorage.getItem('seeded')) { localStorage.clear(); localStorage.setItem('mmdt_blank_v1', st); localStorage.setItem('seeded', '1'); } }, seed);
        }
        const p = await c.newPage(); const errs = [];
        const reqs = [];
        p.on('pageerror', e => errs.push(e.message)); p.on('dialog', x => x.accept()); p.on('request', r => { if (r.url().includes('/api/mmdt-state')) reqs.push(r.method()); });
        await p.goto(url + '/dashboard.html');
        await p.waitForFunction(() => window.SYNC && SYNC.ready, null, { timeout: 10000 });
        await p.waitForFunction(() => SYNC.shadow && !SYNC.busy && syncClean(), null, { timeout: 10000 }).catch(() => {});
        await sleep(300);
        return { p, ctx: c, errs, reqs };
      },
      async stop() { pr.kill(); for (const c of ctxs) await c.close().catch(() => {}); } };
  }
  const settle = async x => { await sleep(1100); await x.p.waitForFunction(() => !SYNC.busy && syncClean(), null, { timeout: 10000 }).catch(() => {}); await sleep(200); };
  const pullD = async x => { await x.p.waitForFunction(() => !SYNC.busy, null, { timeout: 10000 }).catch(() => {}); await x.p.evaluate(() => syncPull()); await sleep(800); };
  const both = async (a, b) => { await settle(a); await settle(b); await pullD(a); await pullD(b); await settle(a); await settle(b); };
  const oldSt = (todos, notiz, pre) => ({ v: 14, lang: 'de', cursem: '2', spec: 'none', prog: 'no', picked: { MGTHN0189: '2' }, cs: {}, notiz, aufg: { MGTHN0189: todos.map((t, i) => ({ id: pre + i, t, d: false, p: 0 })) }, weTodo: [], cust: [], dl: { done: {}, custom: [] } });
  try {
    { // Notiz: beide haengen Zeilen an -> beide bleiben; gleiche Zeile geaendert -> beide Fassungen mit Konflikt-Markierung
      const E = await senv(); const A = await E.dev(), Bd = await E.dev();
      await A.p.evaluate(() => { state.notiz = 'Basis'; save(); }); await settle(A); await pullD(Bd);
      await A.p.evaluate(() => { state.notiz = 'Basis\nA: Vorlesung Termin 5'; save(); });
      await Bd.p.evaluate(() => { state.notiz = 'Basis\nB: Abgabe Freitag'; save(); });
      await both(A, Bd);
      const n1 = E.srv().notiz || '', a1 = await A.p.evaluate(() => state.notiz);
      ok('Sync Notiz: Zeilen beider Geraete bleiben (3-Wege-Textmerge), alle gleich', /^Basis\n/.test(n1) && n1.includes('A: Vorlesung Termin 5') && n1.includes('B: Abgabe Freitag') && !n1.includes('Konflikt') && a1 === n1, JSON.stringify(n1));
      await A.p.evaluate(() => { state.notiz = 'Basis\nA: Termin 6'; save(); });
      await Bd.p.evaluate(() => { state.notiz = 'Basis\nB: Termin 7'; save(); });
      await both(A, Bd);
      const n2 = E.srv().notiz || '';
      ok('Sync Notiz: dieselbe Zeile beidseitig geaendert -> beide Fassungen + "--- Konflikt"', n2.includes('A: Termin 6') && n2.includes('B: Termin 7') && /--- Konflikt .* ---/.test(n2), JSON.stringify(n2));
      await E.stop();
    }
    { // To-do: A hakt ab, B setzt Prioritaet; Kursstatus: A bestanden + Note, B Notiz -> feldweise beides
      const E = await senv(); const A = await E.dev(), Bd = await E.dev();
      await A.p.evaluate(() => { state.picked.MGTHN0189 = '2'; state.aufg.MGTHN0189 = [{ id: 't1', t: 'Case lesen', d: false, p: 0 }]; state.cs.MGTHN0189 = { s: 'warteliste', g: '', n: '' }; save(); syncCourseStatus(); });
      await settle(A); await pullD(Bd);
      await A.p.evaluate(() => { state.aufg.MGTHN0189[0].d = true; state.cs.MGTHN0189 = { s: 'bestanden', g: '1,7', n: '' }; save(); });
      await sleep(120);
      await Bd.p.evaluate(() => { state.aufg.MGTHN0189[0].p = 3; state.cs.MGTHN0189 = { s: 'warteliste', g: '', n: 'Prof. mailen' }; save(); });
      await both(A, Bd);
      const s = E.srv(), td = (s.aufg && s.aufg.MGTHN0189 || [])[0] || {}, cs = (s.cs || {}).MGTHN0189 || {};
      ok('Sync feldweise: To-do abgehakt (A) + Prioritaet (B) bleiben beide', td.d === true && td.p === 3, JSON.stringify(td));
      ok('Sync feldweise: Kursstatus bestanden + Note (A) + Notiz (B) bleiben beide', cs.s === 'bestanden' && cs.g === '1,7' && cs.n === 'Prof. mailen', JSON.stringify(cs));
      await E.stop();
    }
    { // Zuordnung (picked) ohne Eintrags-Zeitstempel: neuere Wahl gewinnt, auch wenn das Geraet mit der aelteren spaeter pusht; Uhr +10 Min
      const E = await senv(); const A = await E.dev({ skew: 10 * 60e3 }), Bd = await E.dev();
      await A.p.evaluate(() => { state.picked.MGTHN0189 = '2'; state.aufg.MGTHN0189 = [{ id: 'k1', t: 'x', d: false, p: 0 }]; save(); }); await settle(A); await pullD(Bd);
      await A.ctx.setOffline(true);
      await A.p.evaluate(() => { state.picked.MGTHN0189 = '3'; state.aufg.MGTHN0189 = []; save(); });   // frueher, Uhr geht 10 Min vor
      await sleep(1500);
      await Bd.p.evaluate(() => { state.picked.MGTHN0189 = '4'; state.aufg.MGTHN0189[0].p = 3; save(); }); await settle(Bd);   // spaeter
      await A.ctx.setOffline(false); await pullD(A); await settle(A); await pullD(Bd); await settle(Bd);
      const s = E.srv();
      ok('Sync Zuordnung: neuere Semesterwahl gewinnt trotz spaeterem Push des anderen Geraets (Uhr +10 Min korrigiert)', (s.picked || {}).MGTHN0189 === '4', JSON.stringify(s.picked));
      ok('Sync Uhrversatz: spaetere Bearbeitung schlaegt frueheres Loeschen des Geraets mit vorgehender Uhr', ((s.aufg || {}).MGTHN0189 || []).length === 1 && A.errs.length === 0, JSON.stringify(s.aufg));
      await E.stop();
    }
    { // Erstabgleich ohne gemeinsamen Stand: eigene Eintraege bleiben (Server neuer); leeres Geraet uebernimmt den Server
      const now = Date.now();
      const E = await senv({ ts: now - 1000, state: oldSt(['Server-Todo'], 'Notiz vom Mac', 's') });
      const A = await E.dev({ seed: JSON.stringify(oldSt(['Lokal-Todo (offline angelegt)'], 'Notiz vom Handy offline', 'l')) });
      await settle(A);
      const a = await A.p.evaluate(() => ({ t: (state.aufg.MGTHN0189 || []).map(x => x.t).sort().join('|'), n: state.notiz })), s = E.srv();
      ok('Sync Erstabgleich (Server neuer, lokal eigene Eintraege): nichts geht verloren', a.t === 'Lokal-Todo (offline angelegt)|Server-Todo' && a.n.includes('Notiz vom Handy offline') && a.n.includes('Notiz vom Mac')
        && (s.aufg.MGTHN0189 || []).length === 2 && s.notiz === a.n, JSON.stringify(a));
      const C = await E.dev(); await settle(C);
      const c = await C.p.evaluate(() => ({ t: (state.aufg.MGTHN0189 || []).length, n: state.notiz }));
      ok('Sync Erstabgleich: Geraet ohne eigene Eintraege uebernimmt den Serverstand', c.t === 2 && c.n === a.n, JSON.stringify(c));
      await E.stop();
    }
    { // zwei Tabs, ein localStorage: Tab 2 pusht, Tab 1 (veraltet) speichert waehrend Serverausfall und laedt neu
      const E = await senv(); const T1 = await E.dev(), T2 = await E.dev({ ctx: T1.ctx });
      await T1.p.evaluate(() => { state.picked.MGTHN0189 = '2'; state.aufg.MGTHN0189 = [{ id: 'k1', t: 'Basis-Todo', d: false, p: 0 }]; save(); }); await settle(T1); await pullD(T2);
      await T2.p.evaluate(() => { state.aufg.MGTHN0189.push({ id: 'x1', t: 'X von Tab2', d: false, p: 0 }); save(); }); await settle(T2);
      await T1.ctx.route('**/api/mmdt-state', r => r.abort());
      await T1.p.evaluate(() => { state.notiz = 'T1 Notiz waehrend Ausfall'; save(); }); await sleep(1500);
      await T1.p.reload(); await sleep(800);
      await T1.ctx.unroute('**/api/mmdt-state');
      await pullD(T1); await settle(T1);
      const t1 = await T1.p.evaluate(() => ({ t: (state.aufg.MGTHN0189 || []).map(x => x.t).join('|'), n: state.notiz })), s = E.srv();
      ok('Sync zwei Tabs: Meta passt zum gespeicherten state -> To-do aus Tab 2 bleibt, Notiz aus Tab 1 bleibt', t1.t === 'Basis-Todo|X von Tab2' && t1.n === 'T1 Notiz waehrend Ausfall'
        && (s.aufg.MGTHN0189 || []).length === 2 && s.notiz === t1.n, JSON.stringify(t1) + ' ' + JSON.stringify(s.aufg && s.aufg.MGTHN0189 && s.aufg.MGTHN0189.map(x => x.t)));
      await E.stop();
    }
    { // F1: Notiz bei Konflikt nur den strittigen Abschnitt markieren; lange Texte; nie still kuerzen
      const { ctx, p, errs } = await open(browser, NEW);
      const r = await p.evaluate(() => {
        const one = syncText('a\nb\nc', 'a\nB1\nc', 'a\nB2\nc').replace(/Konflikt .*?: dieses/, 'Konflikt X: dieses');
        const many = tag => Array.from({ length: 2500 }, (_, i) => i === 3 ? tag : 'z' + i).join('\n');
        const big = syncText(many('base'), many('A') + '\nA-ende', many('B'));
        const mid = syncText(many('base'), many('A'), many('B'));   // nur Zeile 3 strittig
        const sep = syncText(many('base'), many('base').replace('\nz2000\n', '\nzA\n'), many('base').replace('\nz10\n', '\nzC\n'));   // getrennte Stellen
        const pre = syncText('Hallo', 'Hallo Welt wie', 'Hallo Welt');
        let n = Array.from({ length: 120 }, (_, i) => 'Vorlesungsnotiz Zeile ' + i + ' mit etwas Text zum Fuellen').join('\n'); const len0 = n.length;
        for (let k = 1; k <= 6; k++) { const a = n.split('\n'), b = n.split('\n'); a[2] = 'A-Edit ' + k; b[2] = 'B-Edit ' + k; n = syncText(n, a.join('\n'), b.join('\n')); }
        const st = freshState(); st.notiz = 'x'.repeat(150000); const kept = migrateState(st).notiz.length, imp = migrateState(st, { import: true }).notiz.length;
        state.notiz = st.notiz; syncWarnShow(); const warn = (document.getElementById('sync-warn') || {}).textContent || '';
        return { one, midLines: mid.split('\n').length, sepOk: !sep.includes('Konflikt') && sep.includes('\nzA\n') && sep.includes('\nzC\n') && sep.split('\n').length === 2500, bigLines: big.split('\n').length, bigHas: big.includes('\nA\n') && big.includes('\nB\n') && big.includes('A-ende') && big.includes('z2499') && /--- Ende Konflikt ---/.test(big),
          pre, grow: n.length / len0, grows: [1, 2, 3, 4, 5, 6].every(k => n.includes('A-Edit ' + k) && n.includes('B-Edit ' + k)), kept, imp, warn };
      });
      ok('F1 Notiz: nur der strittige Abschnitt markiert (dieses Geraet / andere Fassung / Ende)', r.one === 'a\n--- Konflikt X: dieses Gerät ---\nB1\n--- andere Fassung ---\nB2\n--- Ende Konflikt ---\nc', JSON.stringify(r.one));
      ok('F1 Notiz: 2500 Zeilen (Zeilenvergleich zu gross): nur strittige Zeile markiert, getrennte Stellen ohne Konflikt, sonst Bereich markiert', r.midLines === 2504 && r.sepOk && r.bigHas, JSON.stringify([r.midLines, r.sepOk, r.bigLines]));
      ok('F1 Notiz: 6 Konfliktrunden -> alle Fassungen da, Text waechst nur um die Bloecke (< 1,5x)', r.grows && r.grow < 1.5, r.grow.toFixed(2));
      ok('F1/F3 Notiz: lokal = Server + weitergetippt -> lokal ohne Konflikt', r.pre === 'Hallo Welt wie', r.pre);
      ok('F1 Notiz: 150.000 Zeichen beim Laden/Sync nicht gekuerzt (Import weiter 20.000), sichtbare Warnung', r.kept === 150000 && r.imp === 20000 && /Notiz sehr lang/.test(r.warn), JSON.stringify([r.kept, r.imp, r.warn]));
      const s5 = await p.evaluate(() => { const st = freshState(); st.notiz = ''; st.lang = 'en'; const a = syncHasUserData(st); const b = freshState(); b.dl.done.fr1 = true; const c = freshState(); c.collapsed.x = true; const d = freshState(); d.strat.maxEcts = 30; return [a, syncHasUserData(b), syncHasUserData(c), syncHasUserData(d), syncHasUserData(freshState())].join(); });
      ok('F5: Einstellungen (Sprache, dl.done, collapsed, Planer) zaehlen als eigene Daten', s5 === 'true,true,true,true,false', s5);
      ok('F1/F5: keine Fehler', !errs.length, errs.join(' | '));
      await ctx.close();
    }
    { // F1 im Sync: drei Konfliktrunden zwischen zwei Geraeten, nichts abgeschnitten, alle gleich
      const E = await senv(); const A = await E.dev(), Bd = await E.dev();
      const base = Array.from({ length: 120 }, (_, i) => 'Vorlesungsnotiz Zeile ' + i + ' mit etwas Text zum Fuellen').join('\n');
      await A.p.evaluate(b => { state.notiz = b; save(); }, base); await settle(A); await pullD(Bd);
      let okAll = true, info = '';
      for (let k = 1; k <= 3; k++) {
        await A.ctx.setOffline(true); await Bd.ctx.setOffline(true);
        await A.p.evaluate(k => { const l = state.notiz.split('\n'); l[5] = 'A-Edit Runde ' + k; state.notiz = l.join('\n'); save(); }, k);
        await Bd.p.evaluate(k => { const l = state.notiz.split('\n'); l[5] = 'B-Edit Runde ' + k; state.notiz = l.join('\n'); save(); }, k);
        await A.ctx.setOffline(false); await pullD(A); await settle(A); await Bd.ctx.setOffline(false); await both(A, Bd); await pullD(A); await settle(A);
        const n = E.srv().notiz || '', na = await A.p.evaluate(() => state.notiz);
        const f = [n.includes('A-Edit Runde ' + k), n.includes('B-Edit Runde ' + k), n.includes('Zeile 119'), na === n, n.length < base.length * 1.5];
        info += ` R${k}: ${n.length} ${f.map(Number).join('')}`;
        if (f.includes(false)) okAll = false;
      }
      ok('F1 Sync: 3 Konfliktrunden -> beide Fassungen je Runde, Ende der Notiz bleibt, Geraete gleich', okAll, info);
      await E.stop();
    }
    { // F2: Uhr +10 Min und Server ohne Date-Header -> nach Konflikt keine PUTs im Leerlauf
      const E = await senv(); const A = await E.dev({ skew: 10 * 60e3, noDate: true }), Bd = await E.dev();
      await A.p.evaluate(() => { state.picked.MGTHN0189 = '2'; state.aufg.MGTHN0189 = [{ id: 'k1', t: 'eins', d: false, p: 0 }, { id: 'k2', t: 'zwei', d: false, p: 0 }]; save(); }); await settle(A); await pullD(Bd);
      await A.ctx.setOffline(true); await Bd.ctx.setOffline(true);
      await A.p.evaluate(() => { state.aufg.MGTHN0189[0].d = true; state.aufg.MGTHN0189 = state.aufg.MGTHN0189.filter(x => x.id !== 'k2'); save(); });
      await sleep(500);
      await Bd.p.evaluate(() => { state.aufg.MGTHN0189[0].p = 2; state.aufg.MGTHN0189[1].p = 3; save(); });
      await A.ctx.setOffline(false); await Bd.ctx.setOffline(false);
      for (let i = 0; i < 3; i++) await both(A, Bd);
      const n0 = A.reqs.filter(m => m === 'PUT').length + Bd.reqs.filter(m => m === 'PUT').length;
      for (let i = 0; i < 3; i++) await both(A, Bd);
      const idle = A.reqs.filter(m => m === 'PUT').length + Bd.reqs.filter(m => m === 'PUT').length - n0;
      // Geraet mit richtiger Uhr: nichts von A weit in der Zukunft
      const fut = await Bd.p.evaluate(() => { const lim = Date.now() + 120e3; let bad = 0; const chk = v => { if (typeof v === 'number' && v > lim + 1e3) bad++; };
        Object.values(state._t).forEach(chk); Object.values(state._tm).forEach(chk); (state.aufg.MGTHN0189 || []).forEach(x => { chk(x._t); Object.values(x._tf || {}).forEach(chk); }); return bad; });
      ok('F2: Uhr +10 Min ohne Date-Header -> keine PUTs im Leerlauf, beim anderen Geraet keine Zeitstempel weit in der Zukunft', idle === 0 && fut === 0, `idle ${idle}, Zukunft ${fut}`);
      await E.stop();
    }
    { // F3: PUT kommt an, Antwort geht verloren, Geraet tippt weiter -> kein Konflikt mit sich selbst
      const E = await senv(); const A = await E.dev(), Bd = await E.dev();
      await A.p.evaluate(() => { state.notiz = 'Sauber'; save(); }); await settle(A); await pullD(Bd);
      await A.ctx.route('**/api/mmdt-state', async r => { if (r.request().method() === 'PUT') { await r.fetch(); await r.abort(); } else await r.continue(); });
      await A.p.evaluate(() => { state.notiz = 'Sauber und es geht weiter'; save(); }); await sleep(2500);
      await A.p.evaluate(() => { state.notiz = 'Sauber und es geht weiter und weiter'; save(); }); await sleep(2500);
      await A.ctx.unroute('**/api/mmdt-state');
      await both(A, Bd); await both(A, Bd);
      const na = await A.p.evaluate(() => state.notiz), nb = await Bd.p.evaluate(() => state.notiz);
      ok('F3: verlorene PUT-Antwort -> kein Selbstkonflikt, alle haben den letzten Stand', na === 'Sauber und es geht weiter und weiter' && nb === na && E.srv().notiz === na, JSON.stringify([na, nb]));
      await E.stop();
    }
    { // F4: ohne shadow (Meta weg) kommen anderswo entfernte Map-Schluessel nicht zurueck
      const E = await senv(); const A = await E.dev(), Bd = await E.dev();
      await A.p.evaluate(() => { state.dl.done.fr1 = true; state.collapsed.cc = true; state.notiz = 'Notiz A'; save(); }); await settle(A); await pullD(Bd);
      await A.ctx.setOffline(true);
      await Bd.p.evaluate(() => { delete state.dl.done.fr1; delete state.collapsed.cc; save(); }); await settle(Bd);
      await A.p.evaluate(() => { localStorage.removeItem(STORAGE_KEY + '_sync'); });
      await A.ctx.setOffline(false); await A.p.reload(); await A.p.waitForFunction(() => SYNC.ready); await sleep(1200); await both(A, Bd);
      const a = await A.p.evaluate(() => [Object.keys(state.dl.done).join(), Object.keys(state.collapsed).join(), state.notiz].join('|')), s = E.srv();
      ok('F4: Erstabgleich ohne shadow -> entfernte dl.done/collapsed bleiben entfernt, Notiz bleibt', a === '||Notiz A' && !Object.keys(s.dl.done).length && !Object.keys(s.collapsed).length, a);
      await E.stop();
    }
    for (const order of ['abwaehlen_zuerst', 'status_zuerst']) {   // F6: Kurs auf A abgewaehlt, auf B Kursstatus geaendert
      const E = await senv(); const A = await E.dev(), Bd = await E.dev();
      await A.p.evaluate(() => { state.picked.MGTHN0111 = '2'; state.cs.MGTHN0111 = { s: 'warteliste', g: '', n: '' }; save(); }); await settle(A); await pullD(Bd);
      await A.ctx.setOffline(true); await Bd.ctx.setOffline(true);
      const delA = () => A.p.evaluate(() => { delete state.picked.MGTHN0111; save(); });
      const chgB = () => Bd.p.evaluate(() => { state.cs.MGTHN0111 = { s: 'bestanden', g: '1,3', n: 'ok' }; save(); });
      if (order === 'abwaehlen_zuerst') { await delA(); await sleep(400); await chgB(); } else { await chgB(); await sleep(400); await delA(); }
      await A.ctx.setOffline(false); await Bd.ctx.setOffline(false);
      for (let i = 0; i < 2; i++) await both(A, Bd);
      const s = E.srv(), cs = (s.cs || {}).MGTHN0111 || {};
      if (order === 'abwaehlen_zuerst') ok('F6: Status nach dem Abwaehlen geaendert -> Kurs bleibt gewaehlt, Status bestanden 1,3', s.picked.MGTHN0111 === '2' && cs.s === 'bestanden' && cs.g === '1,3', JSON.stringify([s.picked.MGTHN0111, cs]));
      else {
        const ui = await A.p.evaluate(() => [!!COURSE_STATUS.MGTHN0111, !!document.querySelector('[data-cs-status="MGTHN0111"]')].join());
        ok('F6: spaeter abgewaehlt -> Kurs abgewaehlt, Status bleibt gespeichert (nicht angezeigt)', s.picked.MGTHN0111 === undefined && cs.s === 'bestanden' && ui === 'false,false', JSON.stringify([s.picked.MGTHN0111, cs, ui]));
      }
      await E.stop();
    }
    { // F7c: Lesefehler/leerer Server ohne Grund -> 500 bzw. weder zusammenfuehren noch pushen
      const E = await senv(); const A = await E.dev();
      await A.p.evaluate(() => { state.notiz = 'Daten'; save(); }); await settle(A);
      const good = fs.readFileSync(E.file, 'utf8');
      fs.writeFileSync(E.file, '{kaputt');
      const g = await fetch(E.url + '/api/mmdt-state'), pu = await fetch(E.url + '/api/mmdt-state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ts: 1, base: 0, state: {} }) });
      ok('F7c serve.py: unlesbare Datei -> GET 500, PUT 500, Datei nicht ueberschrieben', g.status === 500 && pu.status === 500 && fs.readFileSync(E.file, 'utf8') === '{kaputt', g.status + ' ' + pu.status);
      fs.writeFileSync(E.file, good);
      await A.ctx.route('**/api/mmdt-state', r => r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: '{"ts":0,"state":null}' }) : r.continue());
      const n0 = A.reqs.filter(m => m === 'PUT').length;
      await A.p.evaluate(() => { state.notiz = 'Daten 2'; save(); }); await sleep(2500);
      const r = await A.p.evaluate(() => [SYNC.hold, SYNC.base > 0, state.notiz].join());
      ok('F7c Client: Server meldet ploetzlich "leer" (base > 0) -> kein PUT, kein Merge', A.reqs.filter(m => m === 'PUT').length === n0 && r === 'true,true,Daten 2' && E.srv().notiz === 'Daten', r);
      await A.ctx.unroute('**/api/mmdt-state'); await A.p.evaluate(() => syncPull()); await settle(A);
      ok('F7c Client: Server wieder normal -> Aenderung kommt an', E.srv().notiz === 'Daten 2', E.srv().notiz);
      await E.stop();
    }
    { // Paritaet: ts kein Zahlwert -> 400 (serve.py)
      const E = await senv();
      const r = await fetch(E.url + '/api/mmdt-state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ts: 'abc', state: {} }) });
      const r2 = await fetch(E.url + '/api/mmdt-state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ts: true, state: {} }) });
      ok('serve.py: ts "abc" / true -> 400', r.status === 400 && r2.status === 400, r.status + ' ' + r2.status);
      await E.stop();
    }
  } finally { procs.forEach(x => { try { x.kill(); } catch (e) {} }); }

  // neuer Client gegen alten Server (kein 409): vor jedem Push ziehen + zusammenfuehren
  {
    let mem = { ts: 0, state: null };
    const html = fs.readFileSync(NEW);
    const old = http.createServer((q, s) => {
      if (q.url.startsWith('/api/mmdt-state')) {
        if (q.method === 'GET') { s.setHeader('Content-Type', 'application/json'); return s.end(JSON.stringify(mem)); }
        let b = ''; q.on('data', d => { b += d; }); q.on('end', () => { const d = JSON.parse(b); const ts = Number(d.ts) || 0;   // altes Verhalten: neuerer ts gewinnt, base unbekannt
          if (ts >= mem.ts) mem = { ts, state: d.state }; s.setHeader('Content-Type', 'application/json'); s.end(JSON.stringify({ ok: true, ts: Math.max(ts, mem.ts) })); });
        return;
      }
      s.setHeader('Content-Type', 'text/html'); s.end(html);
    });
    const op = await freePort(); await new Promise(r => old.listen(op, '127.0.0.1', r));
    const A = await open(browser, null, { url: `http://127.0.0.1:${op}/d.html`, keep: true, clock: null });
    const Bq = await open(browser, null, { url: `http://127.0.0.1:${op}/d.html`, w: 1280, keep: true, clock: null });
    await sleep(1200);
    await addTodo(A.p, 'Handy-Todo');
    await until(() => todos(mem.state) === 'Handy-Todo');
    await Bq.p.evaluate(() => { state.notiz = 'Mac-Notiz'; save(); });
    await until(() => mem.state && mem.state.notiz === 'Mac-Notiz');
    ok('Kompatibel: neuer Client + alter Server (ohne 409) -> beide Aenderungen bleiben', todos(mem.state) === 'Handy-Todo' && mem.state.notiz === 'Mac-Notiz', JSON.stringify(mem.state && mem.state.aufg));
    await A.ctx.close(); await Bq.ctx.close(); old.close();
  }

  // Pages-Function (Cloudflare) mit Mock-KV
  if (process.env.PAGES_FN && fs.existsSync(process.env.PAGES_FN)) {
    const fn = await import('file://' + process.env.PAGES_FN);
    const kv = new Map(), env = { MMDT_STATE: { get: async k => kv.has(k) ? kv.get(k) : null, put: async (k, v) => { kv.set(k, v); } } };
    const req = body => { const t = JSON.stringify(body); return new Request('https://x/api/mmdt-state', { method: 'PUT', headers: { 'content-length': String(Buffer.byteLength(t)), 'content-type': 'application/json' }, body: t }); };
    const call = async (h, a) => { const r = await h(a); return { status: r.status, j: await r.json() }; };
    let r = await call(fn.onRequestGet, { env });
    ok('Pages: GET leer -> {ts:0, state:null}', r.status === 200 && r.j.ts === 0 && r.j.state === null, JSON.stringify(r));
    r = await call(fn.onRequestPut, { request: req({ ts: 1000, state: { a: 1 } }), env });
    ok('Pages: PUT ohne base (alter Client) -> gespeichert', r.status === 200 && r.j.ts === 1000 && JSON.parse(kv.get('state')).state.a === 1, JSON.stringify(r));
    r = await call(fn.onRequestPut, { request: req({ ts: 500, state: { a: 2 } }), env });
    ok('Pages: PUT ohne base mit aelterem ts -> nicht gespeichert', r.status === 200 && JSON.parse(kv.get('state')).state.a === 1 && r.j.stored === false, JSON.stringify(r));
    r = await call(fn.onRequestPut, { request: req({ ts: 2000, base: 999, state: { a: 3 } }), env });
    ok('Pages: veraltete base -> 409 + aktueller Stand', r.status === 409 && r.j.ts === 1000 && r.j.state.a === 1 && JSON.parse(kv.get('state')).state.a === 1, JSON.stringify(r));
    r = await call(fn.onRequestPut, { request: req({ ts: 5, base: 1000, state: { a: 4 } }), env });
    ok('Pages: passende base -> gespeichert, ts = gespeichert + 1', r.status === 200 && r.j.stored === true && r.j.ts === 1001 && JSON.parse(kv.get('state')).state.a === 4, JSON.stringify(r));
    r = await call(fn.onRequestPut, { request: req({ ts: 5, base: 'x', state: {} }), env });
    ok('Pages: base kein Zahlwert -> 400', r.status === 400, JSON.stringify(r));
    r = await call(fn.onRequestPut, { request: req({ ts: 'abc', state: {} }), env });
    const r2 = await call(fn.onRequestPut, { request: req({ ts: true, state: {} }), env });
    ok('Pages: ts kein Zahlwert ("abc", true) -> 400 wie serve.py', r.status === 400 && r2.status === 400, r.status + ' ' + r2.status);
    r = await call(fn.onRequestPut, { request: new Request('https://x/api/mmdt-state', { method: 'PUT', body: '' }), env });
    ok('Pages: ohne Content-Length -> 411', r.status === 411, JSON.stringify(r));
    kv.set('state', '{kaputt');
    r = await call(fn.onRequestGet, { env });
    const r3 = await call(fn.onRequestPut, { request: req({ ts: 5, base: 0, state: { a: 9 } }), env });
    ok('Pages (F7c): unlesbarer KV-Inhalt -> GET 500, PUT 500, nichts ueberschrieben', r.status === 500 && r3.status === 500 && kv.get('state') === '{kaputt', r.status + ' ' + r3.status);
    kv.set('state', JSON.stringify({ ts: 10, state: { a: 1 } }));
    const realPut = env.MMDT_STATE.put; env.MMDT_STATE.put = async (k, v) => { await realPut(k, v); await realPut(k, JSON.stringify({ ts: 11, state: { a: 'anderer' }, w: 'fremd' })); };   // paralleler PUT gewinnt
    r = await call(fn.onRequestPut, { request: req({ ts: 5, base: 10, state: { a: 2 } }), env });
    ok('Pages (F7d): paralleler PUT ueberschreibt -> Zuruecklesen erkennt es, 409 mit dem anderen Stand', r.status === 409 && r.j.state.a === 'anderer', JSON.stringify(r));
    env.MMDT_STATE.put = realPut;
  } else skip('Pages-Function (Mock-KV)', 'PAGES_FN nicht gesetzt (Funktion liegt im Hosting-Repo)');

  // ================================================================ (3) XSS
  console.error("# (3) XSS");
  const X = '<img src=x onerror="window.__xss=(window.__xss||0)+1">', Y = '"><svg onload="window.__xss=1"><b x="', Z = "'><img src=x onerror='window.__xss=1'>";
  const evil = {
    v: 14, lang: 'de', cursem: '2', spec: 'none', picked: { 'X-evil01': '2', MGTHN0189: '2', MGTHN0111: '2' }, notiz: X + Y,
    cust: [{ id: 'X-evil01', t: X + ' Plan', c: 6, cat: 'mgmt_other' }],
    cs: { 'X-evil01': { s: 'fixplatz', g: '', n: Y }, MGTHN0189: { s: 'bestanden', g: '1,3', n: Z } },
    aufg: { 'X-evil01': [{ id: 'e1', t: X, d: false }], MGTHN0189: [{ id: 'e2', t: '28.10. ' + Y, d: false }] },
    weTodo: [{ id: 'w1', t: Z, d: false }],
    dl: { done: {}, custom: [{ id: 'd1', title: X, date: '2026-11-11', type: 'abgabe', action: Y }] },
  };
  const xssCheck = p => p.evaluate(() => ({ x: window.__xss || 0, el: document.querySelectorAll('img[src="x"], svg[onload], [onerror], [onload]').length }));
  for (const [style, file] of [[null, NEW], ['glass', XSS], [null, XSS]]) {
    const ls = { mmdt_blank_v1: JSON.stringify(evil), mmdt_cockpit_token: 'geheim-123', mmdt_cockpit_url: 'http://127.0.0.1:9/mmdt',
      mmdt_cockpit_cache: JSON.stringify({ stand: new Date().toISOString(), aufgaben: [{ id: 'c1', titel: X, kurs: 'MGTHN0189', status: 'offen', faellig: '2026-11-02', link: 'javascript:window.__xss=1' }],
        fristen: [{ id: 'f1', titel: Y, kurs: 'MGTHN0189', art: 'abgabe', faellig_am: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10), status: 'offen' }],
        kalender: { stand: '', events: [{ id: 'k1', title: X, start: new Date().toISOString(), end: new Date(Date.now() + 36e5).toISOString(), allDay: false, location: Y, wichtig: { kurs: X, was: Y, abgabe: true }, uni: true }] } }) };
    const { ctx, p, errs } = await open(browser, file, { style, ls });
    const nm = `XSS ${path.basename(file)}${style ? ' Glas' : ''}`;
    await p.evaluate(x => { if (EXAMS.MGTHN0111) EXAMS.MGTHN0111.text = x; }, X);   // wie ein Pruefungstext aus dem Modulhandbuch
    for (const [v, s] of VIEWS) {
      await go(p, v, s);
      if (v === 'heute') await p.evaluate(() => { const g = GCAL; GCAL = null; renderWochenplan(); renderNow(); GCAL = g; });   // Wochenplan ohne Google-Kalender (Blockkurse, Hinweise)
      if (s === 'kalender') for (const kv of ['month', 'week', 'conflicts', 'overview']) { await p.click(`[data-skal-view="${kv}"]`); await p.waitForTimeout(120); }
      if (s === 'module') { await p.evaluate(() => { state.activeCat = 'all'; modQuery = ''; renderModList(); }); for (const id of ['X-evil01', 'MGTHN0111', 'MGTHN0189']) await p.evaluate(id => { const el = document.querySelector(`#mod-list .mod-info[data-toggle="${id}"]`); if (el) el.click(); }, id); }
      if (s === 'pfad') await p.evaluate(() => { const b = document.querySelector('[data-ps="2"]'); if (b) b.click(); });
    }
    await p.evaluate(() => { const d = document.querySelector('.semb-dot'); if (d) d.click(); document.getElementById('open-note').click(); });
    await p.waitForTimeout(200);
    const r = await xssCheck(p);
    const txt = await p.evaluate(() => document.body.innerText.includes('<img src=x onerror='));
    ok(`${nm}: kein Script ausgefuehrt, keine eingeschleusten Elemente (alle Ansichten, Cockpit-Cache, Kalender)`, r.x === 0 && r.el === 0, JSON.stringify(r));
    if (file === XSS) ok(`${nm}: "</script>" in Build-Daten bricht nicht aus dem Script aus (Titel, GCAL-Text unveraendert)`, (await p.title()) !== 'PWNED'
      && await p.evaluate(() => GCAL_STATIC.events.some(e => e.title.includes('</script><script>')) && TUM_LIVE.stand.includes('</script>')));
    ok(`${nm}: Texte erscheinen als Text`, txt);
    ok(`${nm}: keine Fehler`, !errs.length, errs.join(' | '));
    await ctx.close();
  }
  {   // h9: Import einer praeparierten Datei, Token darf nicht abfliessen; Laengen/Typen begrenzt
    const { ctx, p, errs } = await open(browser, NEW, { ls: { mmdt_cockpit_token: 'geheim-123' } });
    const f = path.join(os.tmpdir(), 'mmdt-xss-import.json');
    fs.writeFileSync(f, JSON.stringify({ picked: { 'X-evil01': '2', '<b>': '2' }, cust: [{ id: 'X-evil01', t: '<img src=x onerror="window.__leak=localStorage.mmdt_cockpit_token">Plan' + 'y'.repeat(500), c: 6, cat: 'mgmt_other' }, { id: 'X-zahl1', t: 123, c: 6 }],
      notiz: 'n'.repeat(50000), aufg: { 'X-evil01': Array.from({ length: 300 }, (_, i) => ({ id: 'i' + i + '"x', t: 't'.repeat(1000), d: 'ja', p: 7 })) }, strat: { maxEcts: '<b>', need: { methods: 1e9 } },
      thesis: { start: 'x', done: { topic: 'yes', a: true, '<x>': true } }, _t: { notiz: 'x', spec: 5 }, _del: { 'aufg:x|1': 1, 'evil': 2 } }));
    await p.setInputFiles('#file-input', f); await p.waitForTimeout(400);
    await p.reload(); await p.waitForTimeout(500);
    for (const [v, s] of VIEWS) await go(p, v, s);
    const r = await p.evaluate(() => ({ leak: window.__leak, cust: state.cust.map(c => c.t.length), notiz: state.notiz.length, aufg: state.aufg['X-evil01'].length, tl: state.aufg['X-evil01'][0].t.length,
      id: state.aufg['X-evil01'][0].id, d: state.aufg['X-evil01'][0].d, p: state.aufg['X-evil01'][0].p, picked: Object.keys(state.picked), strat: [state.strat.maxEcts, state.strat.need.methods],
      thesis: [state.thesis.start, Object.keys(state.thesis.done).join()], t: state._t, del: Object.keys(state._del) }));
    ok('Import (h9): Token fliesst nicht ab', r.leak === undefined && (await xssCheck(p)).x === 0, String(r.leak));
    ok('Import: Laengen begrenzt (Kurs 100, Notiz 20000, To-dos 100 x 300), falsche Typen verworfen',
      r.cust.join() === '100' && r.notiz === 20000 && r.aufg === 100 && r.tl === 300 && r.d === false && r.p === 0 && /^[\w-]+$/.test(r.id), JSON.stringify(r).slice(0, 200));
    ok('Import: Schluessel/Zahlen geprueft (Modul-ID, Planer, Thesis, Sync-Felder)', r.picked.includes('X-evil01') && !r.picked.some(k => /[<>]/.test(k)) && r.strat.join() === '36,12' && /^\d{4}-\d{2}-\d{2}$/.test(r.thesis[0]) && r.thesis[1] === 'a'
      && Object.keys(r.t).every(k => r.t[k] > 1e12) && !('spec' in r.t) && !r.del.includes('evil') && !r.del.includes('aufg:x|1'), JSON.stringify({ s: r.strat, th: r.thesis, t: r.t, d: r.del }));
    // Sync-Pull: Serverstand mit boesartigen Daten wird genauso geprueft
    const s = await p.evaluate(ev => { state.notiz = 'nnnnn lokal'; save(); syncAdopt(Date.now() + 1000, ev);   /* kein gemeinsamer Stand + eigene Eintraege -> Vereinigung (v22) */ return { x: window.__xss || 0, cust: state.cust[0].t.length, el: document.querySelectorAll('img[src="x"], [onerror]').length, notiz: document.getElementById('note-text').value.includes('<img src=x onerror=') && state.notiz.startsWith('nnnnn') }; },
      Object.assign({}, evil, { cust: [{ id: 'X-evil01', t: evil.cust[0].t + 'z'.repeat(300), c: 6, cat: 'mgmt_other' }] }));
    ok('Sync-Pull: boesartiger Serverstand -> geprueft, gekuerzt, escaped', s.x === 0 && s.el === 0 && s.cust === 100 && s.notiz === true, JSON.stringify(s));
    ok('Import/Sync: keine Fehler', !errs.length, errs.join(' | '));
    await ctx.close();
  }

  // ================================================================ (4) Semester dynamisch
  console.error("# (4) Semester dynamisch");
  {
    const { ctx, p, errs } = await open(browser, NEW, { w: 1280, h: 900 });
    await go(p, 'planen', 'kalender');
    const r = await p.evaluate(() => {
      const pills = [...document.querySelectorAll('#skal-view .skal-pill[data-skal-act="month"]')].map(x => x.textContent.replace(/\s*●/, '').trim());
      const today = new Date(), dn = SKAL.dnOf(today.getFullYear(), today.getMonth() + 1, today.getDate()), mon = dn - SKAL.dowOf(dn);
      return { pills, title: document.querySelector('#skal-view .skal-title').textContent, kw: SKAL.isoWeek(mon), sem: [SEM.code, SEM.short, SEM.fallback, D14.toIso(SEM_START), D14.toIso(SEM_END_FALLBACK), D14.toIso(SEM_TERM_END)],
        h: document.querySelector('[data-t="skal_title"]').textContent, ws: document.querySelector('[data-t="mod_ws_only"]').textContent, ics: SKAL.buildIcs().text.includes('X-WR-CALNAME:MMDT WS 26/27'),
        tags: [...new Set([...document.querySelectorAll('#mod-list .mod-tag.ws, #mod-list .mod-tag.nows')].map(x => x.textContent))].sort().join('|'),
        reg: [...document.querySelectorAll('#alerts .chip-t')].some(x => /Anmeldung WS/.test(x.textContent)) };
    });
    ok('Semester heute: 26W aus TUM_LIVE, Tabelle (12.10.2026 / 05.02.2027 / 31.03.2027)', r.sem.join() === '26W,WS 26/27,false,2026-10-12,2027-02-05,2027-03-31', r.sem.join());
    ok('Semester heute: Monate Okt 2026 - Feb 2027 wie bisher', r.pills.slice(0, 5).join() === 'Okt 2026,Nov 2026,Dez 2026,Jan 2027,Feb 2027' && r.title === 'Oktober 2026', r.pills.join() + ' ' + r.title);
    ok('Semester heute: Texte "WS 26/27" (Kalender, Filter, Tags, ICS)', r.h === 'Kalender WS 26/27' && r.ws === 'Nur im WS 26/27 angeboten' && r.tags === 'WS 26/27|kein WS-Kurs' && r.ics, `${r.h} / ${r.ws} / ${r.tags}`);
    ok('Semester heute: Anmelde-Hinweis (bis 07.10.2026) aus', !r.reg);
    await p.click('[data-skal-view="week"]'); await p.waitForTimeout(150);
    const w = await p.evaluate(() => ({ title: document.querySelector('#skal-view .skal-title').textContent, start: document.querySelector('[data-skal-act="wstart"]').textContent,
      prev: document.querySelector('[data-skal-act="wprev"]').disabled }));
    ok(`Semester heute: Woche startet in der aktuellen Woche (KW ${r.kw})`, w.title.startsWith('KW ' + r.kw + ' ') && w.start === 'KW ' + r.kw && !w.prev, JSON.stringify(w));
    for (let i = 0; i < 30; i++) await p.evaluate(() => { const b = document.querySelector('[data-skal-act="wprev"]'); if (!b.disabled) b.click(); });
    const wmin = await p.evaluate(() => document.querySelector('#skal-view .skal-title').textContent);
    for (let i = 0; i < 40; i++) await p.evaluate(() => { const b = document.querySelector('[data-skal-act="wnext"]'); if (!b.disabled) b.click(); });
    const wmax = await p.evaluate(() => document.querySelector('#skal-view .skal-title').textContent);
    // erwarteter Bereich: Vorlesungszeit 12.10.2026-05.02.2027 vereinigt mit den Vorschau-Terminen (Montag dieser Woche -2 .. +11 Wochen, Mo-Fr); heute = alter fester Bereich KW 41-5
    const DAY = 864e5, utc = d => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()), monU = u => u - ((new Date(u).getUTCDay() + 6) % 7) * DAY;
    const t0 = monU(utc(FIXED)), a = Math.min(Date.UTC(2026, 9, 12), t0 - 14 * DAY), b = Math.max(Date.UTC(2027, 1, 5), t0 + 81 * DAY);
    const p2 = n => String(n).padStart(2, '0'), wk = u => { const d = new Date(u), e = new Date(u + 4 * DAY); return `${p2(d.getUTCDate())}.${d.getUTCMonth() === e.getUTCMonth() ? '' : p2(d.getUTCMonth() + 1) + '.'}–${p2(e.getUTCDate())}.${p2(e.getUTCMonth() + 1)}.${e.getUTCFullYear()}`; };
    ok(`Semester: Wochen von ${wk(monU(a) - 7 * DAY)} bis ${wk(monU(b))} (am 29.10.2026 wie bisher KW 41 - KW 5)`, wmin.includes(wk(monU(a) - 7 * DAY)) && wmax.includes(wk(monU(b))), wmin + ' / ' + wmax);
    ok('Semester heute: keine Fehler', !errs.length, errs.join(' | '));
    await ctx.close();
  }
  {
    const { ctx, p, errs } = await open(browser, SOSE, { w: 1280, h: 900, clock: new Date('2027-05-10T10:00:00+02:00') });
    await go(p, 'planen', 'kalender');
    const r = await p.evaluate(() => ({
      pills: [...document.querySelectorAll('#skal-view .skal-pill[data-skal-act="month"]')].map(x => x.textContent.replace(/\s*●/, '').trim()).join(),
      title: document.querySelector('#skal-view .skal-title').textContent, sem: [SEM.code, SEM.short, SEM.fallback, D14.toIso(SEM_START), D14.toIso(SEM_TERM_END)].join(),
      h: document.querySelector('[data-t="skal_title"]').textContent, ws: document.querySelector('[data-t="mod_ws_only"]').textContent,
      sembEnd: document.querySelectorAll('#semb .semb-v')[1].textContent, ics: SKAL.buildIcs().text.includes('X-WR-CALNAME:MMDT SoSe 27'),
      old: [WS2627.has('MGTHN0084'), !!SCHEDULE.MGTHN0094, (SKAL_DATA.MGTHN0188.dates || []).length, SCHEDULE.MGTHN0189 ? SCHEDULE.MGTHN0189[0].d : -1].join(),
      first: SKAL.fmtD(SKAL.EVENTS[0].day), cursem: state.cursem }));
    ok('SoSe (10.05.2027): Semester 27S, Fallback Vorlesungsbeginn 12.04.2027, Ende 30.09.2027', r.sem === '27S,SoSe 27,true,2027-04-12,2027-09-30', r.sem);
    ok('SoSe: Monate aus den Terminen (Apr - Jul 2027), Titel April 2027', r.pills === 'Apr 2027,Mai 2027,Jun 2027,Jul 2027' && r.title === 'April 2027', r.pills + ' ' + r.title);
    ok('SoSe: Texte "SoSe 27" (Kalender, Filter, ICS), Semesterleiste bis letzter Termin', r.h === 'Kalender SoSe 27' && r.ws === 'Nur im SoSe 27 angeboten' && r.ics && r.sembEnd === '29.07.2027', `${r.h} / ${r.ws} / ${r.sembEnd}`);
    ok('SoSe: WS-Daten der Vorlage verworfen (Angebot, Wochenraster, Einzeltermine), Build-Daten bleiben', r.old === 'false,false,0,0' && r.cursem === '3', r.old + ' ' + r.cursem);
    await p.click('[data-skal-view="week"]'); await p.waitForTimeout(150);
    const w = await p.evaluate(() => document.querySelector('#skal-view .skal-title').textContent);
    ok('SoSe: Woche startet in KW 19 (aktuelle Woche)', w.startsWith('KW 19 · 10.–14.05.2027'), w);
    await go(p, 'planen', 'module');
    const tags = await p.evaluate(() => [...new Set([...document.querySelectorAll('#mod-list .mod-tag.ws, #mod-list .mod-tag.nows')].map(x => x.textContent))].sort().join('|'));
    ok('SoSe: Modul-Tags "SoSe 27" / "kein SoSe-Kurs"', tags === 'SoSe 27|kein SoSe-Kurs', tags);
    ok('SoSe: keine Fehler', !errs.length, errs.join(' | '));
    await ctx.close();
  }
  for (const [clock, exp] of [['2027-11-03T10:00:00+01:00', '27W,WS 27/28,true,2027-10-11,2028-02-04'], ['2026-10-29T10:00:00+01:00', '26W,WS 26/27,false,2026-10-12,2027-02-05'],
    ['2028-04-20T10:00:00+02:00', '28S,SoSe 28,true,2028-04-17,2028-07-21'], ['2027-04-14T12:00:00+02:00', '27S,SoSe 27,true,2027-04-12,2027-07-16']]) {   // SoSe: Ende Freitag der 14. Woche
    const { ctx, p, errs } = await open(browser, TEMPLATE, { clock: new Date(clock) });
    const r = await p.evaluate(() => [SEM.code, SEM.short, SEM.fallback, D14.toIso(SEM.lecStart), D14.toIso(SEM.lecEnd)].join());
    await go(p, 'planen', 'kalender');
    ok(`Ohne Build (Vorlage) am ${clock.slice(0, 10)}: Semester aus dem Datum ${exp.split(',')[0]}${exp.includes('true') ? ' (Fallback-Regel)' : ' (Tabelle)'}`, r === exp && !errs.length, r + ' ' + errs.join(' | '));
    await ctx.close();
  }

  // ================================================================ (5) eigene Semester-Wahl
  console.error("# (5) eigene Semester-Wahl");
  {
    const { ctx, p, errs } = await open(browser, NEW);
    const lab = await p.evaluate(() => [document.getElementById('cursem').value, document.querySelector('#cursem option[value="auto"]').textContent, state.cursem].join('|'));
    ok('Semester-Wahl: Standard "Automatisch (TUMonline: 2. Semester)"', lab === 'auto|Automatisch (TUMonline: 2. Semester)|2', lab);
    await setSem(p, '3'); await p.waitForTimeout(100);
    await p.reload(); await p.waitForTimeout(500);
    const a = await p.evaluate(() => [state.cursem, state.cursemManual, document.getElementById('cursem').value].join('|'));
    ok('Semester-Wahl: eigene Wahl (3) bleibt nach Reload trotz TUMonline (2)', a === '3|true|3', a);
    await setSem(p, 'auto'); await p.waitForTimeout(100);
    const b1 = await p.evaluate(() => state.cursem);
    await p.reload(); await p.waitForTimeout(500);
    const b = await p.evaluate(() => [state.cursem, state.cursemManual, document.getElementById('cursem').value].join('|'));
    ok('Semester-Wahl: "Automatisch" setzt zurueck auf TUMonline (sofort und nach Reload)', b1 === '2' && b === '2|false|auto', b1 + ' ' + b);
    ok('Semester-Wahl: keine Fehler', !errs.length, errs.join(' | '));
    await ctx.close();
  }

  // ================================================================ (7) Handy-Felder >= 16px, Layout 390px (+ Screenshots), Desktop unveraendert
  console.error("# (7) Handy-Felder >= 16px, Layout 390px (+ Screenshots), Desktop unveraendert");
  for (const style of [null, 'glass']) {
    const nm = style ? 'Glas' : 'Klassisch';
    const { ctx, p, errs } = await open(browser, NEW, { style, w: 390, h: 844 });
    const sizes = await p.evaluate(() => [...document.querySelectorAll('input, select, textarea')].filter(e => !/^(checkbox|radio|range|color|file|button|submit|reset|hidden)$/.test(e.type))
      .map(e => [e.id || e.className, parseFloat(getComputedStyle(e).fontSize)]).filter(x => x[1] < 16));
    ok(`iOS ${nm} 390px: alle Eingabefelder >= 16px`, !sizes.length, JSON.stringify(sizes));
    const ov = [];
    for (const [v, s] of VIEWS) { await go(p, v, s); const o = await over(p); if (o) ov.push(v + '/' + (s || '') + ':' + o); await p.screenshot({ path: path.join(out, `ios16-${nm}-390-${v}${s ? '-' + s : ''}.png`), fullPage: true }); }
    await p.evaluate(() => document.getElementById('open-settings').click()); await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(out, `ios16-${nm}-390-settings.png`) });
    const dlgOver = await p.evaluate(() => { const d = document.querySelector('#settings-dlg .sheet-in'); return d.scrollWidth - d.clientWidth; });
    await p.evaluate(() => document.getElementById('close-settings').click());
    await go(p, 'kurse');
    const rowOk = await p.evaluate(() => [...document.querySelectorAll('#reg-table tr:not(.reg-group) td:nth-child(4) select')].every(s => s.getBoundingClientRect().right <= innerWidth));
    ok(`iOS ${nm} 390px: kein horizontaler Ueberlauf (6 Ansichten + Einstellungen), Statusfelder passen`, !ov.length && dlgOver <= 0 && rowOk, ov.join(' ') + ' dlg ' + dlgOver);
    ok(`iOS ${nm} 390px: keine Fehler`, !errs.length, errs.join(' | '));
    await ctx.close();
  }
  for (const [w, h] of [[932, 430], [1024, 1366]]) {   // v22: Touch ohne Maus (iPhone quer, iPad) ebenfalls >= 16px
    const c = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
    const p = await c.newPage(); await p.clock.setFixedTime(FIXED); await p.goto('file://' + NEW); await p.waitForTimeout(500);
    const small = await p.evaluate(() => [...document.querySelectorAll('input, select, textarea')].filter(e => !/^(checkbox|radio|range|color|file|button|submit|reset|hidden)$/.test(e.type) && parseFloat(getComputedStyle(e).fontSize) < 16).length);
    ok(`iOS Touch ${w}px (hover: none, pointer: coarse): alle Eingabefelder >= 16px`, small === 0, String(small));
    await c.close();
  }
  {
    const { ctx, p } = await open(browser, NEW, { w: 1280, h: 900 });
    const d = await p.evaluate(() => [getComputedStyle(document.getElementById('mod-search')).fontSize, getComputedStyle(document.querySelector('.td-add input')).fontSize].join());
    ok('iOS: Desktop unveraendert (Suche 14px, To-do-Feld 13.5px)', d === '14px,13.5px', d);
    await ctx.close();
  }

  // ================================================================ (8) Import zeichnet alles neu
  console.error("# (8) Import zeichnet alles neu");
  {
    const { ctx, p, errs } = await open(browser, NEW, { w: 1280, h: 900 });
    const imp = await p.evaluate(() => { const s = JSON.parse(JSON.stringify(state)); s.notiz = 'IMPORTIERT'; s.spec = 'family'; s.lang = 'en'; s.cust = [{ id: 'X-new999', t: 'Importkurs', c: 6, cat: 'methods' }]; s.picked['X-new999'] = '2'; return JSON.stringify(s); });
    const f = path.join(os.tmpdir(), 'mmdt-import.json'); fs.writeFileSync(f, imp);
    await p.setInputFiles('#file-input', f); await p.waitForTimeout(400);
    const r = await p.evaluate(() => ({ ta: document.getElementById('note-text').value, mods: MODULES.some(m => m.id === 'X-new999'), list: !!document.querySelector('#mod-list [data-id="X-new999"]'),
      spec: document.getElementById('spec').value, lang: document.getElementById('lang').value, html: document.documentElement.lang, path: document.getElementById('semesters').textContent.includes('Importkurs') }));
    ok('Import: Notizfeld, eigener Kurs (Katalog + Liste + Pfad), Einstellungen und Sprache sofort neu', r.ta === 'IMPORTIERT' && r.mods && r.list && r.path && r.spec === 'family' && r.lang === 'en' && r.html === 'en', JSON.stringify(r));
    await p.evaluate(() => { const ta = document.getElementById('note-text'); ta.value += '!'; ta.dispatchEvent(new Event('input')); }); await p.waitForTimeout(700);
    ok('Import: Weitertippen im Notizzettel haengt an (ueberschreibt nicht)', await p.evaluate(() => state.notiz) === 'IMPORTIERT!');
    ok('Import: keine Fehler', !errs.length, errs.join(' | '));
    await ctx.close();
  }

  // ================================================================ (9) Labels, Tastatur
  console.error("# (9) Labels, Tastatur");
  {
    const { ctx, p, errs } = await open(browser, NEW, { w: 1280, h: 900 });
    await go(p, 'planen', 'module');
    const r = await p.evaluate(() => {
      const name = e => (e.getAttribute('aria-label') || (e.getAttribute('aria-labelledby') && (document.getElementById(e.getAttribute('aria-labelledby')) || {}).textContent)
        || (e.id && document.querySelector(`label[for="${e.id}"]`) || {}).textContent || (e.closest('label') || {}).textContent || e.getAttribute('title') || '').trim();
      const ctrls = [...document.querySelectorAll('input,select,textarea,button,[role=button]')].filter(e => e.type !== 'hidden' && e.type !== 'file');
      const un = ctrls.filter(e => !name(e) && !(e.tagName === 'BUTTON' && e.textContent.trim()) && !(e.getAttribute('role') === 'button' && e.textContent.trim()));
      const toggles = [...document.querySelectorAll('.mod-info[data-toggle]')];
      return { un: un.map(e => e.tagName + '.' + (e.id || e.className)).slice(0, 6), n: toggles.length, kb: toggles.filter(e => e.getAttribute('role') === 'button' && e.tabIndex === 0 && e.hasAttribute('aria-expanded')).length,
        cb: document.querySelector('#mod-list .mod .check').getAttribute('aria-label'), sel: document.querySelector('#mod-list .mod-sem').getAttribute('aria-label'),
        labels: ['spec', 'prog', 'cursem', 'lang'].map(id => !!document.querySelector(`label[for="${id}"]`)).join() };
    });
    ok('a11y: alle Bedienelemente der Modulwahl + Einstellungen haben einen Namen', !r.un.length, r.un.join(' '));
    ok('a11y: Checkbox/Semester-Auswahl mit Kursname, Selects mit <label for>', !!r.cb && r.sel === 'Semester für ' + r.cb && r.labels === 'true,true,true,true', JSON.stringify(r));
    ok('a11y: Modul-Details per Tastatur (role=button, tabindex=0, aria-expanded)', r.n > 80 && r.kb === r.n, `${r.kb}/${r.n}`);
    await p.focus('#mod-list .mod-info[data-toggle]');
    const id = await p.evaluate(() => document.activeElement.dataset.toggle);
    await p.keyboard.press('Enter'); await p.waitForTimeout(100);
    const e1 = await p.evaluate(() => [document.activeElement.dataset.toggle, document.activeElement.getAttribute('aria-expanded'), !!document.querySelector('.mod-detail.open'), state.expandedMod].join());
    await p.keyboard.press(' '); await p.waitForTimeout(100);
    const e2 = await p.evaluate(() => [document.activeElement.dataset.toggle, document.activeElement.getAttribute('aria-expanded'), state.expandedMod].join());
    ok('a11y: Enter klappt auf, Leertaste zu, Fokus bleibt auf dem Modul', e1 === `${id},true,true,${id}` && e2 === `${id},false,`, e1 + ' / ' + e2);
    ok('a11y: keine Fehler', !errs.length, errs.join(' | '));
    await ctx.close();
  }

  // ================================================================ (10) lange Woerter auf 320px, (11) Specialization-Text
  console.error("# (10) lange Woerter auf 320px, (11) Specialization-Text");
  for (const style of [null, 'glass']) {
    const { ctx, p, errs } = await open(browser, NEW, { style, w: 320, h: 700 });
    const ov = [];
    for (const name of ['Interdisziplinäres Projektseminar zur Digitalisierung mittelständischer Familienunternehmen in Baden-Württemberg', 'Projektseminar_Digitalisierung_Mittelstand_' + 'x'.repeat(40)]) {
      await p.evaluate(n => { state.cust = [{ id: 'X-long01', t: n, c: 6, cat: 'mgmt_other' }]; state.picked['X-long01'] = '2'; state.boardView = 'all'; injectCustomMods(); renderAll(); }, name);
      for (const [v, s] of VIEWS) { await go(p, v, s); if (v === 'fortschritt') await p.evaluate(() => { document.getElementById('bd-fold').open = true; }); const o = await over(p); if (o) ov.push(`${name.length}:${v}/${s || ''}:${o}`); }
    }
    await go(p, 'kurse'); await p.screenshot({ path: path.join(out, `lang-320-${style || 'classic'}-kurse.png`), fullPage: true });
    ok(`Lange Woerter ${style || 'Klassisch'} 320px: kein horizontaler Ueberlauf`, !ov.length, ov.join(' '));
    ok(`Lange Woerter ${style || 'Klassisch'}: keine Fehler`, !errs.length, errs.join(' | '));
    await ctx.close();
  }
  for (const [lang, exp] of [['de', 'Specialization (ohne Schwerpunkt)'], ['en', 'No management specialization'], ['it', 'Specialization (senza indirizzo)']]) {
    const { ctx, p } = await open(browser, NEW, { lang });
    const r = await p.evaluate(() => [...document.querySelectorAll('#alerts .chip-t')].map(x => x.textContent).join('|'));
    ok(`Specialization ohne Schwerpunkt (${lang}): "${exp}"`, r.includes(exp) && (lang === 'en' || !r.includes('No management specialization')), r);
    await ctx.close();
  }

  await browser.close();
  results.forEach(r => console.log(r[0], r[1], r[2] ? '— ' + String(r[2]).slice(0, 240) : ''));
  const counted = results.filter(r => r[0] !== 'SKIP');
  console.log(counted.filter(r => r[0] === 'FAIL').length + ' FAIL / ' + counted.length);
  process.exitCode = counted.some(r => r[0] === 'FAIL') ? 1 : 0;
})().catch(e => { console.error(e); results.forEach(r => console.log(r[0], r[1], r[2] ? '— ' + String(r[2]).slice(0, 300) : '')); console.log('Absturz'); process.exit(1); });
