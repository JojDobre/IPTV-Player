const { chromium, sleep, ok, setup, ev, click, addPlaylist, fails } = require('./common');
(async () => {
  const b = await chromium.launch();
  // A Slovak-language device: the app still starts in English
  const ctx = await b.newContext({ viewport: { width: 412, height: 860 }, locale: 'sk-SK', hasTouch: true, isMobile: true });
  const p = await ctx.newPage(); const errs = await setup(p);
  ok(await ev(p, () => document.documentElement.lang) === 'en', 'English by default even on a Slovak device');
  for (let i = 0; i < 8 && await p.$('#dialog .tour'); i++) { await p.keyboard.press('Escape'); await sleep(150); }
  ok(/Welcome to OnAir/.test(await p.textContent('.welcome')), 'welcome in English');
  ok(await p.$('.welcome .w-lang [data-v=sk]'), 'language switch on the welcome screen');
  await p.screenshot({ path: 'l-welcome.png' });
  await p.fill; await (async () => { await click(p, '.nav-item[data-screen=settings]'); await sleep(200); await click(p, '[data-act=playlist]'); await sleep(300);
    await p.fill('#plName', 'Test'); await p.fill('#plUrl', 'http://127.0.0.1:9001/playlist.m3u'); await click(p, '[data-act=save-playlist]');
    await p.waitForFunction(() => /Guide loaded|could not/.test(document.querySelector('#libStatusTxt')?.textContent || ''), null, { timeout: 30000 }); })();
  const rows = await ev(p, () => [...document.querySelectorAll('.set-row')].map(r => r.querySelector('.lbl b')?.textContent).filter(Boolean));
  console.log('  settings rows:', rows.join(' | '));
  ok(await ev(p, () => document.querySelector('[data-act=choice][data-k=lang]').textContent) === 'Device language', 'audio default = device language');
  ok(await ev(p, () => document.querySelector('[data-act=choice][data-k=subs]').textContent) === 'Off', 'subtitles off by default');
  await click(p, '[data-act=choice][data-k=lang]'); await sleep(300);
  const opts = await ev(p, () => [...document.querySelectorAll('#dialog .opt')].map(o => o.textContent.trim()));
  ok(opts.length > 25 && opts.includes('Deutsch') && opts.includes('Slovenčina'), 'audio languages list', opts.slice(0, 6).join(', ') + ` … (${opts.length})`);
  await p.screenshot({ path: 'l-audio-list.png' });
  await click(p, '#dialog [data-act=choice-set][data-v=de]'); await sleep(300);
  ok(await ev(p, () => document.querySelector('[data-act=choice][data-k=lang]').textContent === 'Deutsch' && JSON.parse(localStorage.getItem('vysielac2:settings3')).lang === 'de'), 'choice saved');
  await click(p, '[data-act=choice][data-k=subs]'); await sleep(300); await click(p, '#dialog [data-act=choice-set][data-v=auto]'); await sleep(300);
  // guide time shift
  const t = await ev(p, () => { const id = vysielac.channels.find(c => c.name === 'Test HLS 1').id; return id; });
  const before = await ev(p, () => document.querySelector('#gScroll') && 0);
  await click(p, '[data-act=set][data-k=epgShift][data-v="-1"]'); await sleep(300);
  await click(p, '.nav-item[data-screen=guide]'); await sleep(600);
  const shifted = await ev(p, () => document.querySelector('#gScroll .prog.now .pt')?.textContent);
  await click(p, '.nav-item[data-screen=settings]'); await sleep(300);
  await click(p, '[data-act=set][data-k=epgShift][data-v="0"]'); await sleep(300);
  await click(p, '.nav-item[data-screen=guide]'); await sleep(600);
  const plain = await ev(p, () => document.querySelector('#gScroll .prog.now .pt')?.textContent);
  ok(shifted && plain && shifted !== plain, 'guide time shift moves the programmes', `${plain} → −1 h: ${shifted}`);
  await click(p, '.nav-item[data-screen=settings]'); await sleep(300);
  await p.screenshot({ path: 'l-settings.png', fullPage: true });
  await click(p, '[data-act=xfer]'); await sleep(300); await p.screenshot({ path: 'l-xfer.png' }); await p.keyboard.press('Escape');
  // switch to Slovak from the welcome-like seg in settings
  await click(p, '[data-act=set][data-k=ui][data-v=sk]'); await sleep(2000);
  ok(await ev(p, () => document.documentElement.lang) !== 'en', 'Slovak can be chosen');
  const missing = await ev(p, () => 0);
  console.log('errors', errs);
  console.log(fails() ? `FAILS: ${fails()}` : 'ALL OK'); await b.close();
})();
