const { chromium, devices, sleep, ev } = require('./common');
(async () => {
  const b = await chromium.launch();
  for (const [name, opt] of [['phone', { ...devices['Pixel 7'] }], ['tv', { viewport: { width: 1280, height: 720 } }]]) {
    const ctx = await b.newContext(opt);
    await ctx.addInitScript(() => localStorage.setItem('vysielac2:settings3', JSON.stringify({ ui: 'sk' })));
    const p = await ctx.newPage();
    // startup frames: what is visible before the app is ready
    const shots = [];
    p.goto('http://localhost:8080/');
    for (let i = 0; i < 6; i++) { await sleep(60); try { shots.push(await ev(p, () => ({ ready: document.body?.classList.contains('ready'), bg: getComputedStyle(document.body).backgroundColor, vis: document.querySelector('.topbar, header, nav') ? getComputedStyle(document.querySelector('.topbar, header, nav')).visibility : '-' }))); } catch { shots.push('nav'); } }
    console.log(name, 'startup', JSON.stringify(shots));
    await sleep(1500);
    console.log(name, await ev(p, () => [document.querySelector('#dialog h2')?.textContent, document.querySelector('.tour-step')?.textContent, !!document.querySelector('.tour-set'), document.querySelectorAll('.tour-li li').length]));
    await p.screenshot({ path: `t0-${name}-0.png` });
    await p.evaluate(() => document.querySelector('[data-act=tour-go]').click()); await sleep(300);
    console.log(name, await ev(p, () => [document.querySelector('#dialog h2')?.textContent, !!document.querySelector('.tour-set'), document.querySelectorAll('.tour-li li').length]));
    await p.screenshot({ path: `t0-${name}-1.png` });
    await ctx.close();
  }
  await b.close();
})();
