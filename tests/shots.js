// Screenshot every view of the dashboard at phone + desktop width, light + dark. Also logs console errors + overflow.
const { chromium } = require('playwright');
const path = require('path');
const file = process.argv[2];
const outDir = process.argv[3];
const tag = process.argv[4] || '';
(async () => {
  const browser = await chromium.launch();
  const configs = [
    { name: 'phone', viewport: { width: 390, height: 844 }, mobile: true, scheme: 'light' },
    { name: 'phone-dark', viewport: { width: 390, height: 844 }, mobile: true, scheme: 'dark' },
    { name: 'desktop', viewport: { width: 1280, height: 900 }, mobile: false, scheme: 'light' },
  ];
  const views = (process.env.VIEWS || 'heute,fortschritt,kurse,planen').split(',');
  for (const c of configs.filter(c => !process.env.CONFIGS || process.env.CONFIGS.split(',').includes(c.name))) {
    const ctx = await browser.newContext({ viewport: c.viewport, isMobile: c.mobile, hasTouch: c.mobile, colorScheme: c.scheme, deviceScaleFactor: 2, locale: 'de-DE' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
    await page.goto('file://' + file);
    await page.waitForTimeout(800);
    for (const v of views) {
      await page.evaluate(v => { const b = document.querySelector(`#bnav [data-view="${v}"]`); if (b) b.click(); }, v);
      await page.waitForTimeout(500);
      await page.evaluate(() => window.scrollTo(0, 0));
      const over = await page.evaluate(() => {
        const w = document.documentElement.clientWidth; const bad = [];
        document.querySelectorAll('body *').forEach(el => { const r = el.getBoundingClientRect(); if (r.width > 0 && (r.right > w + 1 || r.left < -1) && getComputedStyle(el).position !== 'fixed') bad.push(el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').slice(0, 2).join('.') : '') + ` [${Math.round(r.left)}..${Math.round(r.right)}]`); });
        return { scrollW: document.documentElement.scrollWidth, clientW: w, bad: bad.slice(0, 12) };
      });
      console.log(`${c.name}/${v}: scrollWidth=${over.scrollW} clientWidth=${over.clientW}` + (over.bad.length ? '\n   overflow: ' + over.bad.join('\n   overflow: ') : ''));
      await page.screenshot({ path: path.join(outDir, `${tag}${c.name}-${v}.png`), fullPage: true });
    }
    if (c.name === 'phone' && !process.env.NOSUB) {
      // subviews of Planen
      for (const s of ['module', 'kalender']) {
        await page.evaluate(s => { const b = document.querySelector(`#subnav [data-sub="${s}"]`) || [...document.querySelectorAll('#subnav button')].find(b => b.textContent.toLowerCase().includes(s.slice(0, 4))); if (b) b.click(); }, s);
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(outDir, `${tag}${c.name}-planen-${s}.png`), fullPage: true });
      }
      await page.evaluate(() => document.querySelector('#open-settings').click());
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(outDir, `${tag}${c.name}-settings.png`), fullPage: false });
    }
    if (errors.length) console.log(`${c.name} console: \n   ` + [...new Set(errors)].slice(0, 10).join('\n   '));
    await ctx.close();
  }
  await browser.close();
})();
