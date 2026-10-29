// Darstellung Hell/Dunkel/Automatisch: node theme-test.js <preview.html> <shotDir>
const { chromium } = require('playwright');
const path = require('path');
const [file, out] = process.argv.slice(2);
const results = [];
const ok = (name, cond, info = '') => results.push([cond ? 'OK  ' : 'FAIL', name, info]);
const LIGHT_BG = 'rgb(238, 236, 225)', DARK_BG = 'rgb(0, 0, 0)', LIGHT_CARD = 'rgb(255, 255, 255)', DARK_CARD = 'rgb(28, 28, 30)';
async function page(browser, scheme, theme, w = 390) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, isMobile: w < 800, hasTouch: w < 800, colorScheme: scheme, deviceScaleFactor: 2, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
  await p.goto('file://' + file); await p.waitForTimeout(200);
  await p.evaluate(th => { localStorage.clear(); if (th) localStorage.setItem('mmdt_theme', th); }, theme);
  await p.reload(); await p.waitForTimeout(700);
  return { ctx, p, errs };
}
const look = p => p.evaluate(() => {
  const cs = el => getComputedStyle(el), card = document.querySelector('.now-list') || document.querySelector('.card');
  const metas = [...document.querySelectorAll('meta[name="theme-color"]')].map(m => m.getAttribute('media'));
  const note = document.getElementById('note-dlg');
  return { body: cs(document.body).backgroundColor, card: cs(card).backgroundColor, logo: cs(document.querySelector('.top .tum-logo')).filter,
    paper: cs(note).getPropertyValue('--paper').trim(), scheme: document.documentElement.style.colorScheme, attr: document.documentElement.dataset.theme, metas,
    over: document.documentElement.scrollWidth - document.documentElement.clientWidth, gearR: document.getElementById('open-settings').getBoundingClientRect().right,
    btnR: document.getElementById('theme-btn').getBoundingClientRect().right, sel: document.getElementById('theme').value };
});
(async () => {
  const browser = await chromium.launch();
  // Matrix: System x Einstellung
  for (const [scheme, theme, dark] of [['light', null, false], ['dark', null, true], ['light', 'dark', true], ['dark', 'light', false], ['light', 'auto', false], ['dark', 'auto', true]]) {
    const { ctx, p, errs } = await page(browser, scheme, theme);
    const l = await look(p), nm = `System ${scheme} + ${theme || '(nichts)'}`;
    ok(`${nm}: ${dark ? 'dunkel' : 'hell'} (body/Karte)`, l.body === (dark ? DARK_BG : LIGHT_BG) && l.card === (dark ? DARK_CARD : LIGHT_CARD), `${l.body} / ${l.card}`);
    ok(`${nm}: TUM-Logo ${dark ? 'invertiert' : 'normal'}, Notizzettel-Farbe`, (dark ? /invert/.test(l.logo) : l.logo === 'none') && (l.paper.toLowerCase() === (dark ? '#3a3320' : l.paper.toLowerCase())) && (!dark || l.paper.toLowerCase() === '#3a3320'), l.logo + ' ' + l.paper);
    ok(`${nm}: color-scheme/data-theme/meta`, l.attr === (theme || 'auto') && l.scheme === (theme === 'dark' ? 'dark' : theme === 'light' ? 'light' : '')
      && l.metas[0] === (theme === 'dark' ? 'all' : theme === 'light' ? 'not all' : '(prefers-color-scheme: dark)'), JSON.stringify([l.scheme, l.attr, l.metas]));
    ok(`${nm}: Phone 390 kein Ueberlauf, Kopfzeile passt`, l.over === 0 && l.gearR <= 390 && l.btnR < l.gearR, `over ${l.over}, gear ${l.gearR}`);
    ok(`${nm}: keine Fehler`, !errs.length, errs.join(' | '));
    if (theme === 'dark' || theme === 'light') await p.screenshot({ path: path.join(out, `phone-system-${scheme}-wahl-${theme}.png`) });
    await ctx.close();
  }
  // Wechsel ohne Reload (Auswahl + Knopf), Speicherung, Reload
  {
    const { ctx, p, errs } = await page(browser, 'light', null);
    await p.evaluate(() => { const s = document.getElementById('theme'); s.value = 'dark'; s.dispatchEvent(new Event('change')); });
    let l = await look(p);
    ok('Auswahl Dunkel wirkt ohne Reload', l.body === DARK_BG && l.card === DARK_CARD && await p.evaluate(() => localStorage.getItem('mmdt_theme') === 'dark'), l.body);
    await p.reload(); await p.waitForTimeout(500); l = await look(p);
    ok('Nach Reload bleibt Dunkel (auch Auswahlfeld)', l.body === DARK_BG && l.sel === 'dark');
    const seq = [];
    for (let i = 0; i < 3; i++) { await p.click('#theme-btn'); await p.waitForTimeout(100); const x = await look(p); seq.push(x.attr + ':' + (x.body === DARK_BG ? 'D' : 'H') + ':' + x.sel); }
    ok('Knopf schaltet auto -> hell -> dunkel (Systemschema hell)', seq.join(',') === 'auto:H:auto,light:H:light,dark:D:dark', seq.join(','));
    ok('Knopf-Beschriftung', (await p.getAttribute('#theme-btn', 'aria-label')) === 'Darstellung: Dunkel (antippen zum Wechseln)');
    await p.evaluate(() => { const s = document.getElementById('lang'); s.value = 'en'; s.dispatchEvent(new Event('change')); });
    ok('Sprache en: Beschriftung + Auswahl', (await p.getAttribute('#theme-btn', 'aria-label')) === 'Appearance: Dark (tap to switch)' && (await p.textContent('#theme option[value="auto"]')) === 'Automatic (system)');
    ok('Nicht in state/Export', await p.evaluate(() => !JSON.stringify(state).includes('mmdt_theme') && !('theme' in state)));
    ok('themeMedia: Kombinationen', await p.evaluate(() => themeMedia('(prefers-color-scheme: dark) and (max-width: 767px)', 'dark') === '(max-width: 767px)'
      && themeMedia('(prefers-color-scheme: dark) and (max-width: 767px)', 'light') === 'not all'
      && themeMedia('screen and (prefers-color-scheme: light)', 'light') === 'screen'
      && themeMedia('screen and (prefers-color-scheme: dark) and (min-width: 1px)', 'dark') === 'screen and (min-width: 1px)'
      && themeMedia('print, (prefers-color-scheme: dark)', 'light') === 'print, not all' && themeMedia('(max-width: 767px)', 'dark') === '(max-width: 767px)'));
    const n = await p.evaluate(() => { let c = 0; const w = rs => { for (const r of rs) { if (r instanceof CSSMediaRule && THEME_ORIG.has(r) && /prefers-color-scheme/.test(THEME_ORIG.get(r))) c++; if (r.cssRules) w(r.cssRules); } }; for (const s of document.styleSheets) w(s.cssRules); return c; });
    ok('alle Farbschema-Regeln erfasst', n >= 10, String(n));
    ok('keine Fehler', !errs.length, errs.join(' | '));
    for (const v of ['heute', 'fortschritt', 'kurse', 'planen']) { await p.evaluate(v => setView(v), v); await p.waitForTimeout(250); ok(`Dunkel erzwungen: Ansicht ${v} ohne Ueberlauf`, (await look(p)).over === 0); }
    await p.evaluate(() => setView('heute'));
    await p.evaluate(() => document.getElementById('open-settings').click()); await p.waitForTimeout(400);
    await p.screenshot({ path: path.join(out, 'phone-system-light-wahl-dark-settings.png') });
    await p.evaluate(() => document.getElementById('close-settings').click());
    await p.evaluate(() => document.getElementById('open-note').click()); await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(out, 'phone-system-light-wahl-dark-notiz.png') });
    await ctx.close();
  }
  {
    const { ctx, p, errs } = await page(browser, 'dark', 'light', 1280);
    await p.screenshot({ path: path.join(out, 'desktop-system-dark-wahl-light.png') });
    await p.evaluate(() => document.getElementById('open-settings').click()); await p.waitForTimeout(400);
    await p.screenshot({ path: path.join(out, 'desktop-settings.png') });
    ok('Desktop: kein Ueberlauf, keine Fehler', (await look(p)).over === 0 && !errs.length, errs.join(' | '));
    await ctx.close();
  }
  await browser.close();
  results.forEach(r => console.log(r[0], r[1], r[2] ? '— ' + String(r[2]).slice(0, 220) : ''));
  console.log(results.filter(r => r[0] === 'FAIL').length + ' FAIL / ' + results.length);
  process.exitCode = results.some(r => r[0] === 'FAIL') ? 1 : 0;
})();
