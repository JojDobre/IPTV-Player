const { chromium, devices, sleep, setup, ev } = require('./common');
const langs = process.argv.slice(2);
(async () => {
  const b = await chromium.launch();
  for (const lang of langs) {
    const ctx = await b.newContext({ ...devices['Pixel 7'] });
    await ctx.addInitScript(l => localStorage.setItem('vysielac2:settings3', JSON.stringify({ ui: l })), lang);
    const p = await ctx.newPage(); const errs = await setup(p); await sleep(400);
    const r = await ev(p, () => ({ lang: document.documentElement.lang, h2: document.querySelector('#dialog h2')?.textContent, step: document.querySelector('.ts-lbl')?.textContent, on: document.querySelector('.ts-langs .chip.on')?.textContent }));
    await p.screenshot({ path: `l10n-${lang}-tour.png` });
    // walk a few screens to collect untranslated texts
    for (let i = 0; i < 8 && await p.$('#dialog .tour'); i++) { await p.keyboard.press('Escape'); await sleep(150); }
    for (const s of ['home', 'channels', 'guide', 'search', 'settings']) { await p.evaluate(s => document.querySelector(`.nav-item[data-screen=${s}]`).click(), s); await sleep(350); }
    await p.screenshot({ path: `l10n-${lang}-settings.png` });
    const miss = await ev(p, () => [...window.__i18nMissing]);
    console.log(lang, JSON.stringify(r), 'missing:', miss.length, miss.slice(0, 6).join(' | '), errs.length ? 'ERR ' + errs : '');
    await ctx.close();
  }
  await b.close();
})();
