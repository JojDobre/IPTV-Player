const { chromium, devices, sleep, ok, setup, ev, click, addPlaylist, fails } = require('./common');
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ ...devices['Pixel 7'] });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  const errs = await setup(p);
  console.log('# phone portrait');
  ok(await p.$('#dialog .tour'), 'tour shows on first start');
  await addPlaylist(p);
  const n = await ev(p, () => vysielac.channels.length); ok(n > 3, 'playlist loaded', n);
  // screens
  for (const s of ['home', 'channels', 'guide', 'search', 'settings']) {
    await click(p, `.nav-item[data-screen=${s}]`); await sleep(400);
    const ow = await ev(p, () => document.documentElement.scrollWidth - innerWidth);
    ok(ow <= 0, `screen ${s} without horizontal overflow`, ow);
  }
  // ---- guide zoom
  await click(p, '.nav-item[data-screen=guide]'); await sleep(600);
  const g0 = await ev(p, () => { const r = document.querySelector('#gScroll .g-row'), pr = document.querySelector('#gScroll .prog'); return { h: r.offsetHeight, w: pr.offsetWidth, fs: parseFloat(getComputedStyle(pr.querySelector('.pt')).fontSize), nav: document.querySelector('.nav-item').getBoundingClientRect().height }; });
  const box = await ev(p, () => { const r = document.querySelector('#gScroll').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q, i) => ({ x: q[0], y: q[1], id: i })) });
  const pinchBy = async (from, to) => {
    await touch('touchStart', [[box.x - from, box.y], [box.x + from, box.y]]);
    for (let i = 1; i <= 8; i++) { const d = from + (to - from) * i / 8; await touch('touchMove', [[box.x - d, box.y], [box.x + d, box.y]]); await sleep(30); }
    await touch('touchEnd', []); await sleep(300);
  };
  await pinchBy(40, 120);
  const g1 = await ev(p, () => { const r = document.querySelector('#gScroll .g-row'), pr = document.querySelector('#gScroll .prog'); return { h: r.offsetHeight, w: pr.offsetWidth, fs: parseFloat(getComputedStyle(pr.querySelector('.pt')).fontSize), nav: document.querySelector('.nav-item').getBoundingClientRect().height, scale: visualViewport.scale, z: localStorage.getItem('vysielac2:gzoom') }; });
  ok(g1.scale === 1, 'page is not zoomed by pinch', g1.scale);
  ok(g1.h > g0.h && g1.fs > g0.fs, 'pinch out: cards taller, bigger text', `${g0.h}→${g1.h}px, ${g0.fs}→${g1.fs}px`);
  ok(g1.nav === g0.nav, 'rest of page unchanged (nav)');
  await p.screenshot({ path: 'ph-guide-zoom-in.png' });
  await pinchBy(140, 30); await pinchBy(140, 30);
  const g2 = await ev(p, () => ({ h: document.querySelector('#gScroll .g-row').offsetHeight, scale: visualViewport.scale }));
  ok(g2.h < g0.h && g2.scale === 1, 'pinch in: cards smaller', `${g2.h}px`);
  await p.screenshot({ path: 'ph-guide-zoom-out.png' });
  // rows don't overlap
  const ov = await ev(p, () => { const rs = [...document.querySelectorAll('#gScroll .g-row')].map(r => r.getBoundingClientRect()); return rs.some((r, i) => i && r.top < rs[i - 1].bottom - 0.5); });
  ok(!ov, 'guide rows do not overlap after zoom');
  // one-finger scroll still works
  const st0 = await ev(p, () => document.querySelector('#gScroll').scrollTop);
  await touch('touchStart', [[box.x, box.y + 100]]); for (let i = 1; i < 8; i++) { await touch('touchMove', [[box.x, box.y + 100 - i * 25]]); await sleep(16); } await touch('touchEnd', []); await sleep(400);
  ok(await ev(p, () => document.querySelector('#gScroll').scrollTop) > st0, 'one-finger scroll in guide');
  // reset zoom
  await pinchBy(30, 60); await ev(p, () => { localStorage.setItem('vysielac2:gzoom', '1'); });
  // programme tap → detail
  await click(p, '#gScroll .prog.future'); await sleep(400);
  ok(await ev(p, () => !!document.querySelector('#dialog, .g-detail')), 'tap on a future programme shows detail');
  await p.keyboard.press('Escape'); await sleep(300);
  // ---- player
  await click(p, '.nav-item[data-screen=home]'); await sleep(500);
  const id = await ev(p, () => vysielac.channels.find(c => c.name === 'Test HLS 1').id);
  await ev(p, id => document.querySelector(`.card[data-ch="${id}"]`).scrollIntoView({ block: 'center' }), id); await sleep(300);
  const cr = await ev(p, id => { const r = document.querySelector(`.card[data-ch="${id}"]`).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, id);
  await p.touchscreen.tap(cr.x, cr.y);
  await p.waitForFunction(() => vysielac.engine.state === 'playing', null, { timeout: 20000 }).catch(() => {});
  ok(await ev(p, () => vysielac.engine.state) === 'playing', 'channel plays');
  await sleep(800);
  ok(await ev(p, () => document.querySelectorAll('#ppList .pitem').length) > 2, 'portrait: channel list under the picture');
  // sheets slide from below and the screen does not jump
  for (const act of ['p-prog', 'p-audio', 'p-list', 'p-more', 'p-sleep']) {
    const has = await ev(p, a => !!document.querySelector(`#ppActs [data-act=${a}], .osd [data-act=${a}]`), act);
    if (!has) { console.log('  --   no button', act); continue; }
    const res = await ev(p, async a => {
      const vid = () => document.querySelector('#vid').getBoundingClientRect().top;
      const v0 = vid(), s0 = document.scrollingElement.scrollTop;
      const btn = document.querySelector(`#ppActs [data-act=${a}]`) || document.querySelector(`.osd [data-act=${a}]`);
      btn.click();
      const el = vysielac.P.panel === 'list' ? document.querySelector('#chPanel') : document.querySelector('#sheet');
      const frames = [];
      await new Promise(r => { const t0 = performance.now(); const f = () => { const m = new DOMMatrix(getComputedStyle(el).transform); frames.push({ x: m.m41, y: m.m42, vid: vid(), s: document.scrollingElement.scrollTop, top: el.getBoundingClientRect().top }); if (performance.now() - t0 < 450) requestAnimationFrame(f); else r(); }; requestAnimationFrame(f); });
      const rect = el.getBoundingClientRect();
      return { panel: vysielac.P.panel, xs: frames.map(f => f.x), ys: frames.map(f => Math.round(f.y)), vidMoved: frames.some(f => Math.abs(f.vid - v0) > 0.5), scrolled: frames.some(f => f.s !== s0), top: rect.top, bottom: rect.bottom, h: innerHeight, vbottom: document.querySelector('#vid').getBoundingClientRect().bottom };
    }, act);
    const fromBelow = res.xs.every(x => Math.abs(x) < 1) && res.ys[0] > 50 && res.ys[res.ys.length - 1] === 0 && res.ys.every((y, i) => !i || y <= res.ys[i - 1]);
    ok(fromBelow, `${act}: slides up from the bottom`, 'y ' + res.ys.filter((_, i) => i % 4 === 0).join(','));
    ok(!res.vidMoved && !res.scrolled, `${act}: picture and page stay still`);
    ok(Math.abs(res.top - res.vbottom) < 2 && Math.abs(res.bottom - res.h) < 2, `${act}: sheet sits under the picture`, `${Math.round(res.top)}..${Math.round(res.bottom)}`);
    if (act === 'p-prog') await p.screenshot({ path: 'ph-sheet-prog.png' });
    // close with X → slides down
    await click(p, (res.panel === 'list' ? '#chPanel' : '#sheet') + ' .panel-x'); await sleep(80);
    const mid = await ev(p, pn => new DOMMatrix(getComputedStyle(document.querySelector(pn === 'list' ? '#chPanel' : '#sheet')).transform), res.panel);
    await sleep(400);
    ok(!(await ev(p, () => vysielac.P.panel)) && Math.abs(mid.m41) < 1, `${act}: closes downward`);
  }
  // more → fav
  await ev(p, () => document.querySelector('#ppActs [data-act=p-more], .osd [data-act=p-more]').click()); await sleep(400);
  const more = await ev(p, () => [...document.querySelectorAll('#sheet .mitem')].map(m => m.textContent.trim()));
  ok(more.length >= 3, 'more menu items', more.join(' / '));
  await click(p, '#sheet .panel-x'); await sleep(400);
  // channel switch from list
  const pch = await ev(p, () => vysielac.P.ch);
  await click(p, '#ppList .pitem:not(.cur)'); await sleep(1500);
  ok(await ev(p, id => vysielac.P.ch !== id, pch), 'tune from portrait list');
  // landscape
  console.log('# phone landscape');
  await p.setViewportSize({ width: 915, height: 412 }); await sleep(700);
  await p.touchscreen.tap(450, 200); await sleep(400);
  ok(await ev(p, () => vysielac.P.osd), 'tap shows controls');
  for (const act of ['p-list', 'p-prog']) {
    await click(p, `.osd [data-act=${act}]`); await sleep(500);
    const r = await ev(p, a => { const el = a === 'p-list' ? document.querySelector('#chPanel') : document.querySelector('#sheet'); const b = el.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, w: innerWidth }; }, act);
    ok(r.t < 5 && (r.l < 2 || Math.abs(r.r - r.w) < 2), `${act}: side panel in landscape`, JSON.stringify(r));
    await p.screenshot({ path: `ph-land-${act}.png` });
    await p.keyboard.press('Escape'); await sleep(400);
  }
  // swipe changes channel in landscape
  const ch0 = await ev(p, () => vysielac.P.ch);
  await touch('touchStart', [[450, 300]]); for (let i = 1; i <= 6; i++) { await touch('touchMove', [[452, 300 - i * 30]]); await sleep(16); } await touch('touchEnd', []); await sleep(1200);
  ok(await ev(p, ch0 => vysielac.P.ch !== ch0, ch0), 'swipe up switches channel');
  // swipe off setting
  await ev(p, () => { const s = JSON.parse(localStorage.getItem('vysielac2:settings3') || '{}'); }); 
  const sample = () => ev(p, async () => { let seen = 0; await new Promise(r => { const t0 = performance.now(); const f = () => { for (const el of document.querySelectorAll('.panel')) { const b = el.getBoundingClientRect(); if (getComputedStyle(el).visibility === 'visible' && b.left < innerWidth && b.top < innerHeight && b.right > 0 && b.bottom > 0) seen++; } if (performance.now() - t0 < 500) requestAnimationFrame(f); else r(); }; requestAnimationFrame(f); }); return seen; });
  let fl = sample(); await p.setViewportSize({ width: 412, height: 915 }); ok(await fl === 0, 'rotate to portrait: closed panels never flash');
  await sleep(300); fl = sample(); await p.setViewportSize({ width: 915, height: 412 }); ok(await fl === 0, 'rotate to landscape: closed panels never flash');
  await sleep(300); await p.setViewportSize({ width: 412, height: 915 }); await sleep(600);
  // close player
  await p.keyboard.press('Escape'); await sleep(300); await p.keyboard.press('Escape'); await sleep(500);
  ok(!(await ev(p, () => vysielac.P.open)) || await ev(p, () => document.querySelector('#player').classList.contains('mini')), 'back closes player / mini');
  // long-press menu on a card
  await click(p, '.nav-item[data-screen=home]'); await sleep(400);
  const card = await ev(p, () => { const r = document.querySelector('.card[data-ch]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await touch('touchStart', [[card.x, card.y]]); await sleep(800); await touch('touchEnd', []); await sleep(400);
  ok(await ev(p, () => !!document.querySelector('#dialog .cm-prev, #dialog [data-act]')), 'long press opens channel menu');
  await p.screenshot({ path: 'ph-menu.png' });
  await p.keyboard.press('Escape'); await sleep(300);
  // search
  await click(p, '.nav-item[data-screen=search]'); await sleep(300); await p.fill('#q', 'test'); await sleep(1200);
  ok(await ev(p, () => document.querySelectorAll('#results [data-ch]').length) > 0, 'search finds channels');
  // settings: font size + labels
  await click(p, '.nav-item[data-screen=settings]'); await sleep(300);
  ok(await ev(p, () => document.querySelectorAll('[data-act=set]').length) > 5, 'settings rendered', await ev(p, () => document.querySelectorAll('[data-act=set]').length));
  ok(await ev(p, () => visualViewport.scale) === 1, 'page scale still 1 at the end');
  console.log('errors', errs.length ? errs : 'none');
  console.log(fails() ? `FAILS: ${fails()}` : 'ALL OK');
  await b.close();
})();
