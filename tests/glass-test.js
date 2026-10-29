// v19 Stil Klassisch/Glas: node glass-test.js <base.html (vorher)> <new.html> <shotDir>
// Prueft: Klassisch unveraendert (berechnete Styles + Screenshots gegen base), Glas in Hell/Dunkel/Auto x Handy/Desktop,
// Blur-Ebenen, Kontrast (AA), Ueberlauf, Fehler, Umschalten/Speicherung/Sprache/anderer Tab, Fallbacks. Screenshots nach <shotDir>.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const [base, neu, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const results = [];
const ok = (name, cond, info = '') => results.push([cond ? 'OK  ' : 'FAIL', name, info]);
const FIXED = new Date(); FIXED.setSeconds(0, 0);
const LIGHT_BG = 'rgb(238, 236, 225)', DARK_BG = 'rgb(0, 0, 0)', LIGHT_CARD = 'rgb(255, 255, 255)', DARK_CARD = 'rgb(28, 28, 30)';
const G_LIGHT_BG = 'rgb(241, 238, 230)', G_DARK_BG = 'rgb(6, 9, 19)';
const MODES = [['light', 'light', 'dark', false], ['dark', 'dark', 'light', true], ['auto-hell', 'auto', 'light', false], ['auto-dunkel', 'auto', 'dark', true]];   // name, Einstellung, System, dunkel?
const VPS = [['mobil', 390, 844], ['desktop', 1280, 900]];
const VIEWS = [['heute'], ['fortschritt'], ['kurse'], ['planen', 'pfad'], ['planen', 'module'], ['planen', 'kalender']];

async function open(browser, file, { scheme = 'light', theme = null, style = null, w = 390, h = 844, reducedMotion } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 800, hasTouch: w < 800, colorScheme: scheme, reducedMotion: reducedMotion || 'no-preference',
    deviceScaleFactor: w < 800 ? 2 : 1, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
  await p.clock.setFixedTime(FIXED);
  await p.goto('file://' + file); await p.waitForTimeout(150);
  await p.evaluate(([th, st]) => { localStorage.clear(); if (th) localStorage.setItem('mmdt_theme', th); if (st) localStorage.setItem('mmdt_style', st); }, [theme, style]);
  await p.reload(); await p.waitForTimeout(700);
  return { ctx, p, errs };
}
// v22: bewusste Aenderungen fuer den Vergleich "Klassisch unveraendert" gezielt herausnehmen (in beiden Seiten, falls vorhanden):
// (a) Handy-Regel "Eingabefelder >= 16px" gegen iOS-Zoom (@media max-width 767px, font-size 16px fuer input/select/textarea),
// (b) neuer deutscher/italienischer Text fuer "ohne Specialization" (vorher englisch). Alles andere muss weiter gleich sein.
// (c) v22: Animationen aus (SPAN.pulse u. a. animiert box-shadow; sonst Vergleich je nach Zeitpunkt, auch HEAD gegen HEAD rot)
const neutralizeV22 = p => p.evaluate(() => {
  const st = document.createElement('style'); st.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; }'; document.head.appendChild(st);
  for (const sh of document.styleSheets) {
    let rules; try { rules = sh.cssRules; } catch (e) { continue; }
    for (let i = rules.length - 1; i >= 0; i--) {
      const r = rules[i];
      if (r instanceof CSSMediaRule && /max-width:\s*767px/.test(r.conditionText) && [...r.cssRules].some(x => /textarea/.test(x.selectorText || '') && x.style.fontSize === '16px')) sh.deleteRule(i);
    }
  }
  if (I18N.de.spec_name_none) ['de', 'en', 'it'].forEach(l => { I18N[l].spec_name_none = 'No management specialization'; });
  renderAll();
});
const go = (p, v, s) => p.evaluate(([v, s]) => { setView(v); if (s) document.querySelector(`#subnav [data-sub="${s}"]`).click(); window.scrollTo(0, 0); }, [v, s]).then(() => p.waitForTimeout(450));
const over = p => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
// Berechnete Styles aller sichtbaren Elemente (ohne Einstellungs-Dialog, der ein Feld mehr hat)
const dump = p => p.evaluate(() => {
  const P = ['backgroundColor', 'backgroundImage', 'color', 'borderTopColor', 'borderTopWidth', 'borderLeftColor', 'borderLeftWidth', 'borderRadius', 'boxShadow', 'fontFamily', 'fontSize', 'backdropFilter', 'position', 'opacity', 'filter', 'animationName'];
  const dlg = document.getElementById('settings-dlg'), outv = [];
  const one = (el, pseudo) => { const cs = getComputedStyle(el, pseudo); return P.map(k => cs[k]).join('|') + (pseudo ? '|' + cs.content : ''); };
  outv.push('html ' + one(document.documentElement) + ' body ' + one(document.body) + ' ' + one(document.body, '::before'));
  for (const el of document.body.querySelectorAll('*')) {
    if (dlg.contains(el) || el.tagName === 'SCRIPT') continue;
    const r = el.getBoundingClientRect();
    outv.push(el.tagName + '.' + (typeof el.className === 'string' ? el.className : '') + ' ' + [r.x, r.y, r.width, r.height].map(Math.round).join(',') + ' ' + one(el) + ' ' + one(el, '::before'));
  }
  return outv;
});
// Kontrast: Label-Farben gegen Glasflaeche, zusammengesetzt ueber Grundfarbe und jedes Farbfeld des Hintergrunds
const contrast = p => p.evaluate(() => {
  const rgba = s => { const m = /rgba?\(([^)]+)\)/.exec(s); const a = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [a[0], a[1], a[2], a.length > 3 ? a[3] : 1]; };
  const over = (f, b) => [0, 1, 2].map(i => f[i] * f[3] + b[i] * (1 - f[3])).concat(1);
  const lum = c => { const l = c.slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };
  const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const baseC = rgba(getComputedStyle(document.body).backgroundColor);
  const blobs = (getComputedStyle(document.body, '::before').backgroundImage.match(/rgba\([^)]+\)/g) || []).map(rgba).filter(c => c[3] > 0);
  const grounds = [baseC].concat(blobs.map(b => over(b, baseC)));
  const host = document.querySelector('.now-list') || document.querySelector('.card');
  const probe = (css, parent = host) => { const d = document.createElement('div'); d.style.cssText = css; parent.appendChild(d); const cs = getComputedStyle(d); const r = [cs.color, cs.backgroundColor]; d.remove(); return r; };
  const surf = { karte: probe('background:rgba(var(--g-rgb),var(--g-a1))')[1], leiste: probe('background:rgba(var(--g-rgb),var(--g-a2))')[1], dialog: probe('background:rgba(var(--g-rgb3),var(--g-a3))')[1] };
  const labels = { label: probe('color:var(--label)')[0], label2: probe('color:var(--label-2)')[0], label3: probe('color:var(--label-3)')[0] };
  const sk = document.getElementById('skal-root'); labels.skalMuted = probe('color:var(--skal-muted)', sk)[0];
  let min = 99, worst = '';
  for (const [sn, sv] of Object.entries(surf)) for (const g of grounds) { const eff = over(rgba(sv), g); for (const [ln, lv] of Object.entries(labels)) { const c = cr(rgba(lv), eff); if (c < min) { min = c; worst = `${ln} ${lv} auf ${sn} (${eff.slice(0, 3).map(Math.round)})`; } } }
  return { min: Math.round(min * 100) / 100, worst, grounds: grounds.length };
});
const look = p => p.evaluate(() => {
  const cs = (el, ps) => getComputedStyle(el, ps), card = document.querySelector('.now-list');
  const note = document.getElementById('note-dlg');
  return { attr: document.documentElement.dataset.style, theme: document.documentElement.dataset.theme, body: cs(document.body).backgroundColor, card: cs(card).backgroundColor,
    cardBf: cs(card).backdropFilter, topBf: cs(document.querySelector('.top'), '::before').backdropFilter, topSelfBf: cs(document.querySelector('.top')).backdropFilter,
    navBf: cs(document.getElementById('bnav')).backdropFilter, logo: cs(document.querySelector('.top .tum-logo')).filter,
    paper: cs(note).getPropertyValue('--paper').trim(), paperBg: cs(note.querySelector('.note-paper')).backgroundColor,
    cats: ['--cat-methods', '--cat-digital', '--cat-family', '--cat-digital-spec', '--cat-electives', '--cat-project', '--cat-thesis', '--tum-blau', '--red', '--green', '--orange'].map(k => cs(document.documentElement).getPropertyValue(k).trim()).join(','),
    metas: [...document.querySelectorAll('meta[name="theme-color"]')].map(m => m.getAttribute('content') + '@' + m.getAttribute('media')),
    sel: (document.getElementById('style') || {}).value, anim: cs(document.querySelector('.view.on')).animationName };
});

// Leisten-Labels: Kontrast gegen die echten Pixel dahinter (Text ausgeblendet, Screenshot), 5. Perzentil je Label
const BAR_SEL = ['.kpi-l', '.kpi-v', '.semb-s', '.semb-v', '#bnav button > span', '.mod-filter .tab', '.mod-filter .mod-wsonly span'];
async function barContrast(p, helperPage, dpr) {
  const items = await p.evaluate(sels => {
    const out = [];
    for (const sel of sels) for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect(); if (r.width < 4 || r.height < 4 || r.top < 0 || r.bottom > innerHeight || r.right > innerWidth) continue;
      const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); if (!t || !(el.contains(t) || t.contains(el))) continue;
      let op = 1, a = el; while (a && a !== document.documentElement) { op *= +getComputedStyle(a).opacity; a = a.parentElement; }
      out.push({ sel, txt: el.textContent.trim().slice(0, 16), color: cs.color, op, x: r.left, y: r.top, w: r.width, h: r.height });
    }
    return out;
  }, BAR_SEL);
  const h = await p.addStyleTag({ content: '*,*::before,*::after{color:transparent!important;-webkit-text-fill-color:transparent!important;caret-color:transparent!important}' });
  await p.waitForTimeout(60); const png = (await p.screenshot()).toString('base64'); await h.evaluate(e => e.remove());
  return helperPage.evaluate(async ([png, items, dpr]) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + png; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const L = (r, gg, b) => 0.2126 * lin(r) + 0.7152 * lin(gg) + 0.0722 * lin(b);
    return items.map(it => {
      const m = it.color.match(/[\d.]+/g).map(Number), a = (m.length > 3 ? m[3] : 1) * it.op;
      const d = g.getImageData(Math.round(it.x * dpr), Math.round(it.y * dpr), Math.max(1, Math.round(it.w * dpr)), Math.max(1, Math.round(it.h * dpr))).data, crs = [];
      for (let i = 0; i < d.length; i += 4) { const bg = [d[i], d[i + 1], d[i + 2]], fg = [0, 1, 2].map(k => m[k] * a + bg[k] * (1 - a)); const x = L(...bg), y = L(...fg); crs.push((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)); }
      crs.sort((p, q) => p - q); return { sel: it.sel, txt: it.txt, p5: crs[Math.floor(crs.length * 0.05)] };
    });
  }, [png, items, dpr]);
}
const alpha = s => { const m = /rgba\([^)]*,\s*([\d.]+)\)/.exec(s); return m ? +m[1] : 1; };

(async () => {
  const browser = await chromium.launch();

  // 1) Klassisch unveraendert: Default (nichts gespeichert) und explizit "classic" gegen den Stand vorher
  for (const [vn, w, h] of VPS) for (const [scheme, theme] of [['light', null], ['dark', null], ['light', 'dark']]) {
    for (const st of [null, 'classic']) {
      const A = await open(browser, base, { scheme, theme, w, h });   // je Vergleich frisch (Unteransicht merkt sich die Seite)
      const B = await open(browser, neu, { scheme, theme, style: st, w, h });
      const nm = `Klassisch ${vn} System ${scheme}${theme ? ' + ' + theme : ''}${st ? ' (gespeichert classic)' : ' (Default)'}`;
      await neutralizeV22(A.p); await neutralizeV22(B.p);
      let diff = 0, first = '', shotDiff = 0;
      for (const [v, s] of VIEWS) {
        await go(A.p, v, s); await go(B.p, v, s);
        const da = await dump(A.p), db = await dump(B.p);
        da.forEach((x, i) => { if (x !== db[i]) { diff++; if (!first) first = `${v}${s ? '/' + s : ''}: ${x.slice(0, 120)} <> ${String(db[i]).slice(0, 120)}`; } });
        if (da.length !== db.length) { diff++; first = first || `Elementzahl ${da.length} vs ${db.length}`; }
        const sa = await A.p.screenshot(), sb = await B.p.screenshot();
        if (!sa.equals(sb)) shotDiff++;
      }
      const l = await look(B.p), dark = theme === 'dark' || (!theme && scheme === 'dark');
      ok(`${nm}: berechnete Styles identisch (6 Ansichten)`, diff === 0, first);
      ok(`${nm}: Screenshots pixelgleich (6 Ansichten)`, shotDiff === 0, `${shotDiff} abweichend`);
      ok(`${nm}: data-style=classic, Werte wie vorher`, l.attr === 'classic' && l.body === (dark ? DARK_BG : LIGHT_BG) && l.card === (dark ? DARK_CARD : LIGHT_CARD) && l.cardBf === 'none', `${l.attr} ${l.body} ${l.card}`);
      ok(`${nm}: Statusleiste wie vorher`, l.metas.join() === (await look(A.p)).metas.join(), l.metas.join());
      ok(`${nm}: keine Fehler`, !B.errs.length, B.errs.join(' | '));
      await B.ctx.close(); await A.ctx.close();
    }
  }

  // 2) Glas: Darstellung x Viewport
  const classicRef = {};
  for (const [vn, w, h] of VPS) for (const [mn, theme, scheme, dark] of MODES) {
    const C = await open(browser, neu, { scheme, theme, style: 'classic', w, h });
    classicRef[vn + mn] = await look(C.p); await C.ctx.close();
    const { ctx, p, errs } = await open(browser, neu, { scheme, theme, style: 'glass', w, h });
    const nm = `Glas ${vn} ${mn}`, l = await look(p), ref = classicRef[vn + mn];
    ok(`${nm}: html[data-style=glass], Darstellung ${theme}`, l.attr === 'glass' && l.theme === theme && l.sel === 'glass', `${l.attr}/${l.theme}/${l.sel}`);
    ok(`${nm}: Hintergrund ${dark ? 'Nacht' : 'Tag'}`, l.body === (dark ? G_DARK_BG : G_LIGHT_BG), l.body);
    ok(`${nm}: Karte transluzent + Blur 14px (Ebene 1)`, /blur\(14px\)/.test(l.cardBf) && /saturate\(1\.8\)|saturate\(180%\)/.test(l.cardBf) && alpha(l.card) > 0.4 && alpha(l.card) < 0.8, `${l.card} ${l.cardBf}`);
    ok(`${nm}: Kopfzeile Blur 28px (Ebene 2) ueber ::before, .top selbst ohne Filter`, /blur\(28px\)/.test(l.topBf) && l.topSelfBf === 'none', l.topBf);
    if (w < 800) ok(`${nm}: Bottom-Bar Blur 28px, schwebend`, /blur\(28px\)/.test(l.navBf) && await p.evaluate(() => { const r = document.getElementById('bnav').getBoundingClientRect(); return r.left >= 8 && innerWidth - r.right >= 8 && innerHeight - r.bottom >= 6; }), l.navBf);
    ok(`${nm}: Notizzettel-Papier, Kategorie-Farben, TUM-Logo wie Klassisch`, l.paper === ref.paper && l.paperBg === ref.paperBg && l.cats === ref.cats && l.logo === ref.logo, `${l.paper} ${l.logo}`);
    ok(`${nm}: Statusleiste = Hintergrundfarbe`, l.metas[0].startsWith('#060913') && l.metas[1].startsWith('#F1EEE6'), l.metas.join(' '));
    const c = await contrast(p);
    ok(`${nm}: Kontrast Labels auf Glas >= 4.5 (min ${c.min}, ${c.grounds} Untergruende)`, c.min >= 4.5, c.worst);
    const ov = [];
    for (const [v, s] of VIEWS) { await go(p, v, s); const o = await over(p); if (o) ov.push(`${v}/${s || ''}:${o}`); }
    ok(`${nm}: kein horizontaler Ueberlauf (6 Ansichten)`, !ov.length, ov.join(' '));
    await go(p, 'heute');
    await p.evaluate(() => document.getElementById('open-settings').click()); await p.waitForTimeout(350);
    const sh = await p.evaluate(() => { const s = getComputedStyle(document.getElementById('settings-dlg')); return [s.backdropFilter, s.backgroundColor]; });
    ok(`${nm}: Einstellungs-Sheet Blur 40px (Ebene 3)`, /blur\(40px\)/.test(sh[0]) && alpha(sh[1]) >= 0.6, sh.join(' '));
    ok(`${nm}: keine Fehler`, !errs.length, errs.join(' | '));
    await ctx.close();
  }


  // 2b) Leisten-Labels (Kopfzeile, Bottom-Bar, haftende Modul-Filterleiste) ueber mehrere Scroll-Positionen
  {
    const hb = await browser.newContext(); const helperPage = await hb.newPage();
    for (const [vn, w, h] of VPS) for (const [mn, scheme] of [['hell', 'light'], ['dunkel', 'dark']]) {
      const { ctx, p } = await open(browser, neu, { scheme, style: 'glass', w, h });
      const dpr = w < 800 ? 2 : 1; let min = 99, worst = '', n = 0;
      for (const [v, s] of [['heute'], ['kurse'], ['planen', 'module'], ['planen', 'kalender']]) {
        await go(p, v, s);
        const H = await p.evaluate(() => document.documentElement.scrollHeight - innerHeight);
        for (const y of [0, 300, 700, 1100, 1600, 2400, 3400].filter(y => y <= H)) {
          await p.evaluate(y => window.scrollTo(0, y), y); await p.waitForTimeout(150);
          for (const r of await barContrast(p, helperPage, dpr)) { n++; if (r.p5 < min) { min = r.p5; worst = `${r.sel} "${r.txt}" ${v}${s ? '/' + s : ''} y=${y}`; } }
        }
      }
      ok(`Glas ${vn} ${mn}: Leisten-Labels >= 4.5 ueber Scroll-Positionen (min ${min.toFixed(2)}, ${n} Messungen)`, min >= 4.5, worst);
      await ctx.close();
    }
    await hb.close();
  }

  // 2c) Glas: Notizzettel-Schrift wie Klassisch, Termine deckend, 320px ohne Ueberlauf, Kanten-Overrides greifen
  for (const scheme of ['light', 'dark']) {
    const C = await open(browser, neu, { scheme, style: 'classic' });
    const fontC = await C.p.evaluate(() => [...document.querySelectorAll('#note-dlg, #note-dlg *')].map(e => getComputedStyle(e).fontFamily).join('|'));
    await C.ctx.close();
    const { ctx, p, errs } = await open(browser, neu, { scheme, style: 'glass', w: 320, h: 700 });
    const r = await p.evaluate(() => {
      const fonts = [...document.querySelectorAll('#note-dlg, #note-dlg *')].map(e => getComputedStyle(e).fontFamily).join('|');
      const ev = document.createElement('div'); ev.className = 'skal-ev'; ev.style.setProperty('--skal-cc', '#E37222'); document.getElementById('skal-root').appendChild(ev);
      const evBg = getComputedStyle(ev).backgroundColor; ev.remove();
      const before = (s) => getComputedStyle(document.querySelector(s), '::before').backgroundImage;
      return { fonts, evBg, pop: before('.semb-pop') !== before('.now-list'), now: before('.now-main') !== before('.now-list'),
        th: getComputedStyle(document.querySelector('.th-dot')).backgroundColor };
    });
    ok(`Glas ${scheme}: Notizzettel behaelt die klassische Schrift`, r.fonts === fontC, r.fonts.slice(0, 60));
    ok(`Glas ${scheme}: Kalender-Termine und Zeitstrahl-Punkte deckend`, !/,\s*0?\.\d+\)$/.test(r.evBg) && !/\/ 0?\.\d+\)$/.test(r.evBg) && !/rgba/.test(r.th), r.evBg + ' ' + r.th);
    ok(`Glas ${scheme}: Kanten-Overrides greifen (Popover Ebene 3, Jetzt-Karte)`, r.pop && r.now);
    const ov = [];
    for (const [v, s] of VIEWS) { await go(p, v, s); if (s === 'kalender') { for (const kv of ['month', 'week', 'conflicts', 'overview']) { await p.click(`[data-skal-view="${kv}"]`); await p.waitForTimeout(200); const o = await over(p); if (o) ov.push(`kalender/${kv}:${o}`); } } else { const o = await over(p); if (o) ov.push(`${v}/${s || ''}:${o}`); } }
    ok(`Glas ${scheme} 320px: kein horizontaler Ueberlauf (inkl. Kalender-Unteransichten)`, !ov.length, ov.join(' '));
    ok(`Glas ${scheme} 320px: keine Fehler`, !errs.length, errs.join(' | '));
    await ctx.close();
  }
  // 3) Umschalten, Speicherung, nicht in state, Sprache, anderer Tab, Darstellung im Glas-Stil
  {
    const { ctx, p, errs } = await open(browser, neu, { scheme: 'light' });
    ok('Default ohne Eintrag = Klassisch', (await look(p)).attr === 'classic' && (await look(p)).sel === 'classic');
    await p.evaluate(() => { const s = document.getElementById('style'); s.value = 'glass'; s.dispatchEvent(new Event('change')); });
    let l = await look(p);
    ok('Auswahl Glas wirkt ohne Reload', l.attr === 'glass' && l.body === G_LIGHT_BG && await p.evaluate(() => localStorage.getItem('mmdt_style') === 'glass'), l.body);
    await p.reload(); await p.waitForTimeout(500); l = await look(p);
    ok('Nach Reload bleibt Glas (auch Auswahlfeld)', l.attr === 'glass' && l.sel === 'glass');
    // Zustand in dem Moment, in dem <body> entsteht (vor dem ersten Rendern)
    await p.addInitScript(() => { new MutationObserver((ms, mo) => { if (document.body) { window.__styleAtBody = document.documentElement.getAttribute('data-style'); mo.disconnect(); } }).observe(document, { childList: true, subtree: true }); });
    await p.reload(); await p.waitForTimeout(400);
    const attrEarly = await p.evaluate(() => window.__styleAtBody);
    ok('data-style steht schon beim Entstehen von <body> (kein Aufblitzen)', attrEarly === 'glass', String(attrEarly));
    await p.evaluate(() => { const s = document.getElementById('theme'); s.value = 'dark'; s.dispatchEvent(new Event('change')); });
    l = await look(p);
    ok('Glas + Darstellung Dunkel per Auswahl -> Nacht-Glas', l.body === G_DARK_BG && /rgba\(34, 37, 48/.test(l.card), l.body + ' ' + l.card);
    await p.click('#theme-btn'); l = await look(p);
    ok('Glas + Knopf (dunkel -> auto, System hell) -> Tag-Glas', l.theme === 'auto' && l.body === G_LIGHT_BG, l.body);
    ok('Stil nicht in state/Export', await p.evaluate(() => !JSON.stringify(state).includes('mmdt_style') && !('style' in state) && !JSON.stringify(state).includes('"glass"')));
    const lab = async () => p.evaluate(() => [document.querySelector('label[for="style"]').textContent, document.querySelector('#style option[value="classic"]').textContent, document.querySelector('#style option[value="glass"]').textContent].join('/'));
    ok('Sprache de: Stil/Klassisch/Glas', (await lab()) === 'Stil/Klassisch/Glas', await lab());
    await p.evaluate(() => { const s = document.getElementById('lang'); s.value = 'en'; s.dispatchEvent(new Event('change')); });
    ok('Sprache en: Style/Classic/Glass', (await lab()) === 'Style/Classic/Glass', await lab());
    await p.evaluate(() => { const s = document.getElementById('lang'); s.value = 'it'; s.dispatchEvent(new Event('change')); });
    ok('Sprache it: Stile/Classico/Vetro', (await lab()) === 'Stile/Classico/Vetro', await lab());
    ok('Stil-Auswahl bleibt nach Sprachwechsel', (await look(p)).sel === 'glass');
    // anderer Tab im selben Profil
    const p2 = await ctx.newPage(); await p2.clock.setFixedTime(FIXED); await p2.goto('file://' + neu); await p2.waitForTimeout(500);
    await p2.evaluate(() => { const s = document.getElementById('style'); s.value = 'classic'; s.dispatchEvent(new Event('change')); });
    await p.waitForTimeout(300); l = await look(p);
    ok('Anderer Tab schaltet auf Klassisch -> dieser Tab folgt (storage-Event)', l.attr === 'classic' && l.sel === 'classic' && l.body === LIGHT_BG, l.attr + ' ' + l.body);
    ok('Umschalten: keine Fehler', !errs.length, errs.join(' | '));
    ok('Wechselspeicher sauber (Klassisch-Statusleiste zurueck)', l.metas[0].startsWith('#000000') && l.metas[1].startsWith('#0065BD'), l.metas.join(' '));
    await ctx.close();
  }

  // 4) Fallbacks: Transparenz reduzieren (CDP), @supports-Regel, Bewegung reduzieren
  for (const [scheme, dark] of [['light', false], ['dark', true]]) {
    const { ctx, p, errs } = await open(browser, neu, { scheme, style: 'glass' });
    const cdp = await ctx.newCDPSession(p);
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }, { name: 'prefers-color-scheme', value: scheme }] });
    await p.waitForTimeout(200);
    const matched = await p.evaluate(() => matchMedia('(prefers-reduced-transparency: reduce)').matches);
    const l = await look(p);
    await p.evaluate(() => document.getElementById('open-settings').click()); await p.waitForTimeout(300);
    const sh = await p.evaluate(() => getComputedStyle(document.getElementById('settings-dlg')).backdropFilter);
    const bars = await p.evaluate(() => [getComputedStyle(document.querySelector('.top'), '::before').backgroundColor, getComputedStyle(document.getElementById('bnav')).backgroundColor, getComputedStyle(document.querySelector('.mod-filter')).backgroundColor, getComputedStyle(document.querySelector('.semb-pop')).backgroundColor]);
    ok(`Transparenz reduzieren (${scheme}): deckend, kein Blur (Karten, Leisten, Modul-Filter, Popover, Sheet)`, matched && l.cardBf === 'none' && l.topBf === 'none' && sh === 'none' && alpha(l.card) === 1 && bars.every(c => alpha(c) === 1), `${matched} ${l.card} ${l.cardBf} ${sh} ${bars.join(' ')}`);
    const c = await contrast(p);
    ok(`Transparenz reduzieren (${scheme}): Kontrast >= 4.5 (min ${c.min})`, c.min >= 4.5, c.worst);
    ok(`Transparenz reduzieren (${scheme}): keine Fehler`, !errs.length, errs.join(' | '));
    if (!dark) await p.screenshot({ path: path.join(out, 'mobil-hell-transparenz-reduziert-settings.png') });
    await ctx.close();
  }
  {
    const { ctx, p } = await open(browser, neu, { style: 'glass' });
    const sup = await p.evaluate(() => { const r = []; for (const s of document.styleSheets) for (const x of s.cssRules) if (x instanceof CSSSupportsRule) r.push(x.conditionText + ' => ' + x.cssText); return r; });
    ok('@supports-Fallback ohne backdrop-filter: deckend, kein Blur', sup.some(t => /not/.test(t) && /backdrop-filter/.test(t) && /--g-bf1: none/.test(t) && /--g-a1: 1;/.test(t)), sup.join(' || ').slice(0, 200));
    ok('Glas mit Bewegung: Ansichten blenden nur per Verschiebung ein (v19in)', (await look(p)).anim === 'v19in', (await look(p)).anim);
    await ctx.close();
    const R = await open(browser, neu, { style: 'glass', reducedMotion: 'reduce' });
    ok('Glas + Bewegung reduzieren: keine Ansichts-Animation', (await look(R.p)).anim === 'none', (await look(R.p)).anim);
    await R.ctx.close();
  }

  // 5) Screenshots Glas hell/dunkel x mobil/desktop
  for (const [vn, w, h] of VPS) for (const [mn, scheme] of [['hell', 'light'], ['dunkel', 'dark']]) {
    const { ctx, p, errs } = await open(browser, neu, { scheme, style: 'glass', w, h });
    // Ganze Seite: Viewport auf Seitenhoehe ziehen, damit die fixierte Hintergrund-Ebene und die Bottom-Bar wie im Browser liegen
    const shot = async (n, full = true) => {
      const fp = path.join(out, `${vn}-${mn}-${n}.png`);
      if (!full) return p.screenshot({ path: fp });
      const H = await p.evaluate(() => document.documentElement.scrollHeight);
      await p.setViewportSize({ width: w, height: Math.max(h, H) }); await p.waitForTimeout(200);
      await p.screenshot({ path: fp }); await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(100);
    };
    for (const [v, s] of VIEWS) { await go(p, v, s); await shot(v + (s ? '-' + s : '')); }
    await go(p, 'planen', 'kalender');
    for (const kv of ['week', 'conflicts', 'overview']) { await p.click(`[data-skal-view="${kv}"]`); await p.waitForTimeout(350); await shot('planen-kalender-' + kv); }
    await go(p, 'heute');
    await p.evaluate(() => { const d = document.querySelector('.semb-dot'); if (d) d.click(); }); await p.waitForTimeout(250); await shot('popover', false);
    await p.evaluate(() => document.body.click()); await p.waitForTimeout(150);
    await p.evaluate(() => document.getElementById('open-settings').click()); await p.waitForTimeout(400); await shot('settings', false);
    await p.evaluate(() => document.getElementById('close-settings').click()); await p.waitForTimeout(200);
    await p.evaluate(() => document.getElementById('open-note').click()); await p.waitForTimeout(500); await shot('notiz', false);
    ok(`Screenshots ${vn} ${mn}: keine Fehler`, !errs.length, errs.join(' | '));
    await ctx.close();
  }

  await browser.close();
  results.forEach(r => console.log(r[0], r[1], r[2] ? '— ' + String(r[2]).slice(0, 240) : ''));
  console.log(results.filter(r => r[0] === 'FAIL').length + ' FAIL / ' + results.length);
  process.exitCode = results.some(r => r[0] === 'FAIL') ? 1 : 0;
})();
