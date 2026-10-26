const { chromium, devices, sleep, ok, setup, ev, click, addPlaylist, fails } = require('./common');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['Pixel 7'], viewport: { width: 360, height: 640 }, locale: 'sk-SK' });
  const p = await ctx.newPage(); await setup(p); await addPlaylist(p);
  await click(p, '.nav-item[data-screen=home]'); await sleep(500);
  const r = await ev(p, () => { const r = document.querySelector('.bcard').getBoundingClientRect(); return { x: r.left + 30, y: r.top + 30 }; });
  await p.touchscreen.tap(r.x, r.y); await sleep(2000);
  const s = await ev(p, async () => { const pp = document.querySelector('#pPort'), n0 = document.querySelectorAll('#ppList .pitem').length; pp.scrollTop = pp.scrollHeight; await new Promise(r => setTimeout(r, 400)); return { scrolled: pp.scrollTop, more: document.querySelectorAll('#ppList .pitem').length - n0 }; });
  ok(s.scrolled > 200 && s.more > 0, 'short phone: whole area scrolls and loads more', JSON.stringify(s));
  console.log(fails() ? 'FAILS' : 'ALL OK'); await b.close();
})();
