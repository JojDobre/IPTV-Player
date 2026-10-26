const { chromium, devices, sleep, setup, ev, click, addPlaylist } = require('./common');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['Pixel 7'], locale: 'sk-SK' });
  const p = await ctx.newPage();
  await p.addInitScript(() => { localStorage.setItem('vysielac2:settings3', JSON.stringify({ ui: 'sk', labels: 'off' })); });
  await setup(p); await addPlaylist(p);
  await ev(p, () => { document.documentElement.style.setProperty('--sa-b', '48px'); document.documentElement.style.setProperty('--sa-t', '40px'); document.body.classList.add('touch'); });
  for (const s of ['search', 'channels', 'guide', 'home']) { await click(p, `.nav-item[data-screen=${s}]`); await sleep(600); await p.screenshot({ path: `ui-${s}.png` }); }
  for (const s of ['channels', 'guide']) { await click(p, `.nav-item[data-screen=${s}]`); await sleep(400); console.log(s, await ev(p, sc => { const scr = document.querySelector('#s-' + sc), n = document.querySelector('#topnav').getBoundingClientRect(); scr.scrollTop = 1e6; const last = sc === 'guide' ? document.querySelector('#gScroll').getBoundingClientRect().bottom : [...scr.querySelectorAll('.card')].pop().getBoundingClientRect().bottom; return { navTop: Math.round(n.top), contentBottom: Math.round(last) }; }, s)); }
  await click(p, '.nav-item[data-screen=guide]'); await sleep(300); await ev(p, () => document.querySelector('#s-guide').scrollTop = 0);
  console.log('day chip', await ev(p, () => { const c = document.querySelector('#gDays .chip.on'), r = c.getBoundingClientRect(), rg = document.createRange(); rg.selectNodeContents(c); const t = rg.getBoundingClientRect(); return { padL: Math.round(t.left - r.left), padR: Math.round(r.right - t.right), padT: Math.round(t.top - r.top), padB: Math.round(r.bottom - t.bottom), vis: r.right <= innerWidth }; }));
  await click(p, '.nav-item[data-screen=search]'); await sleep(300); await p.tap('#q'); await sleep(300);
  console.log('kb: nav hidden', await ev(p, () => getComputedStyle(document.querySelector('#topnav')).display === 'none'));
  await p.screenshot({ path: 'ui-kb.png' });
  await ev(p, () => document.activeElement.blur()); await sleep(200);
  console.log('after blur nav shown', await ev(p, () => getComputedStyle(document.querySelector('#topnav')).display !== 'none'));
  console.log(await ev(p, () => { const n = document.querySelector('#topnav').getBoundingClientRect(), m = document.querySelector('main').getBoundingClientRect(); return { navTop: n.top, navH: n.height, mainBottom: m.bottom, mainPadB: getComputedStyle(document.querySelector('main')).paddingBottom, ih: innerHeight }; }));
  await b.close();
})();
