const { chromium, sleep, ok, setup, ev, click, addPlaylist, fails } = require('./common');
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
  await p.addInitScript(() => { if (!localStorage.getItem('vysielac2:settings3')) localStorage.setItem('vysielac2:settings3', JSON.stringify({ ui: 'en', backMini: 'on' })); });
  const errs = await setup(p); await addPlaylist(p);
  await click(p, '.nav-item[data-screen=settings]'); await sleep(400);
  const segs = await ev(p, () => [...document.querySelectorAll('[data-act=set][data-k=buf]')].map(x => x.textContent + (x.classList.contains('on') ? '*' : '')));
  ok(segs.length === 4 && segs.includes('Normal*'), 'buffer setting with 4 sizes, Normal by default', segs.join(','));
  // play a channel
  await click(p, '.nav-item[data-screen=channels]'); await sleep(400);
  await click(p, '[data-ch]'); await sleep(4000);
  const t0 = await ev(p, () => [...document.querySelectorAll('video')].map(v => v.currentTime).reduce((a, b) => Math.max(a, b), 0));
  await p.keyboard.press('Escape'); await sleep(300);
  await click(p, '.nav-item[data-screen=settings]'); await sleep(400);
  await click(p, '[data-act=set][data-k=buf][data-v=big]'); await sleep(6000);
  const st = await ev(p, () => JSON.parse(localStorage.getItem('vysielac2:settings3')).buf);
  ok(st === 'big', 'Large is saved', st);
  const t1 = await ev(p, () => [...document.querySelectorAll('video')].map(v => v.currentTime + ':' + v.paused).join(' '));
  ok(/[1-9][0-9.]*:false/.test(t1), 'channel plays again after switching (mini player)', `before ${t0.toFixed(1)} after ${t1}`);
  await p.reload(); await sleep(1500);
  await click(p, '.nav-item[data-screen=settings]'); await sleep(400);
  ok(await ev(p, () => document.querySelector('[data-act=set][data-k=buf].on')?.dataset.v) === 'big', 'still Large after restart');
  ok(!errs.length, 'no errors', errs.join(' | '));
  console.log(fails() ? `FAILS: ${fails()}` : 'ALL OK'); await b.close();
})();
