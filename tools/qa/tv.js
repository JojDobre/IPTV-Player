const { chromium, sleep, ok, setup, ev, click, addPlaylist, fails } = require('./common');
const UA = 'Mozilla/5.0 (Linux; Android 12; BRAVIA 4K Android TV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  for (const [w, h] of [[1920, 1080], [1280, 720]]) {
    console.log(`# TV ${w}x${h}`);
    const ctx = await b.newContext({ viewport: { width: w, height: h }, userAgent: UA, locale: 'sk-SK' });
    const p = await ctx.newPage();
    const errs = await setup(p);
    const key = async (k, n = 1, d = 160) => { for (let i = 0; i < n; i++) { await p.keyboard.press(k); await sleep(d); } };
    const cur = () => ev(p, () => { const c = vysielac.nav && vysielac.nav.cur || document.querySelector('.focus'); if (!c) return null; const r = c.getBoundingClientRect(); return { act: c.dataset.act, ch: c.dataset.ch, txt: (c.textContent || c.getAttribute('aria-label') || '').trim().slice(0, 30), vis: r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && getComputedStyle(c).visibility !== 'hidden' }; });
    ok(await ev(p, () => document.documentElement.classList.contains('tv')), 'html.tv set');
    // tour with OK only
    ok(await p.$('#dialog .tour'), 'tour on first start');
    let steps = 0; while (await p.$('#dialog .tour') && steps < 12) { await key('Enter', 1, 200); steps++; }
    ok(steps > 3 && !(await p.$('#dialog .tour')), 'tour walked through with OK', steps + ' presses');
    if (await ev(p, () => !document.querySelector('#modal').hidden)) await key('Escape');
    await key('ArrowDown');
    ok((await cur()) !== null, 'remote has a target on empty home', JSON.stringify(await cur()));
    await addPlaylist(p);
    await ev(p, () => document.activeElement && document.activeElement.blur());
    await key('Escape'); await key('Escape');
    // top navigation by keys
    await click(p, '.nav-item[data-screen=home]'); await sleep(400);
    await key('Escape'); // back on home focuses top menu
    let c = await cur(); ok(c && c.act === 'screen', 'Back on home goes to top menu', JSON.stringify(c));
    const visited = [];
    for (let i = 1; i <= 5; i++) { await click(p, '.nav-item[data-screen=home]'); await sleep(300); await key('Escape'); await key('ArrowRight', i); await key('Enter', 1, 500); visited.push(await ev(p, () => vysielac.S.screen)); }
    ok(new Set(visited).size >= 4, 'top menu reaches screens', visited.join(','));
    // home cards
    await click(p, '.nav-item[data-screen=home]'); await sleep(400); await key('Escape'); await key('ArrowDown', 2);
    c = await cur(); ok(c && c.vis, 'arrow down lands on visible item', JSON.stringify(c));
    let lost = 0; for (const k of ['ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp']) { await key(k); const x = await cur(); if (!x || !x.vis) lost++; }
    ok(lost === 0, 'focus stays visible while moving on home', lost);
    // hold OK = menu
    for (let i = 0; i < 6 && !((await cur()) || {}).ch; i++) await key('ArrowDown');
    c = await cur();
    if (c && c.ch) {
      await p.keyboard.down('Enter'); await sleep(800); await p.keyboard.up('Enter'); await sleep(300);
      ok(await ev(p, () => !document.querySelector('#modal').hidden && !!document.querySelector('#dialog .cm-head')), 'hold OK opens channel menu with preview');
      await key('Escape');
      ok(await ev(p, () => document.querySelector('#modal').hidden && !vysielac.P.open), 'Back closes menu, nothing started');
    } else ok(false, 'found a channel card by arrows');
    // OK plays
    await key('Enter', 1, 2500);
    ok(await ev(p, () => vysielac.P.open && !vysielac.P.mini), 'OK opens player');
    const ch1 = await ev(p, () => vysielac.P.ch);
    await key('ArrowUp', 1, 1200); ok(await ev(p, a => vysielac.P.ch !== a, ch1), 'Up switches channel');
    await key('PageDown', 1, 1200); ok(await ev(p, a => vysielac.P.ch === a, ch1), 'CH− goes back');
    // side panels: left = list from the left, right = programme from the right
    for (const [k, name, side] of [['ArrowLeft', 'list', 'left'], ['ArrowRight', 'prog', 'right']]) {
      const rp = ev(p, async ([k, side]) => {
        await new Promise(r => setTimeout(r, 0));
        const el = side === 'left' ? document.querySelector('#chPanel') : document.querySelector('#sheet'); const fr = [];
        await new Promise(r => { const t0 = performance.now(); const f = () => { const m = new DOMMatrix(getComputedStyle(el).transform); fr.push([Math.round(m.m41), Math.round(m.m42)]); if (performance.now() - t0 < 400) requestAnimationFrame(f); else r(); }; requestAnimationFrame(f); });
        const b = el.getBoundingClientRect(); return { fr, l: b.left, r: b.right, h: b.height };
      }, [k, side]);
      await p.keyboard.press(k); const r = await rp; await sleep(150);
      const okAnim = r.fr.every(f => f[1] === 0) && (side === 'left' ? r.fr[0][0] < -50 : r.fr[0][0] > 50) && r.fr[r.fr.length - 1][0] === 0;
      ok(okAnim, `${name} panel slides in from the ${side} on TV`);
      ok(r.h >= h - 2, `${name} panel full height`);
      c = await cur(); const hasItems = await ev(p, s => !!document.querySelector((s === 'left' ? '#chPanel' : '#sheet') + ' .f:not(.panel-x)'), side);
      ok(hasItems ? c && c.vis : true, `${name}: focused item visible`, hasItems ? JSON.stringify(c) : 'no EPG, nothing to focus');
      if (!hasItems) { await key('Escape', 1, 400); continue; }
      await key('ArrowDown', 3); c = await cur(); ok(c && c.vis, `${name}: still visible after moving`);
      await p.screenshot({ path: `tv${w}-${name}.png` });
      await key('Escape', 1, 400); ok(await ev(p, () => !vysielac.P.panel), `Back closes ${name}`);
    }
    // OSD
    await key('Enter', 1, 400); ok(await ev(p, () => vysielac.P.osd), 'OK shows controls');
    await key('ArrowDown'); for (let i = 0; i < 8; i++) { await key('ArrowRight'); c = await cur(); if (!c || !c.vis) { ok(false, 'OSD focus visible', JSON.stringify(c)); break; } }
    await p.screenshot({ path: `tv${w}-osd.png` });
    ok(!(await ev(p, () => [...document.querySelectorAll('.osd .m-only')].some(e => e.offsetParent))), 'no phone-only buttons on TV');
    await key('Escape', 1, 400); ok(await ev(p, () => !vysielac.P.osd), 'Back hides controls');
    // numbers
    await key('3', 1, 2500); ok(await ev(p, () => vysielac.channels.find(c => c.id === vysielac.P.ch).n) === 3, 'number key 3 tunes channel 3', await ev(p, () => vysielac.channels.find(c => c.id === vysielac.P.ch).n));
    await key('d', 1, 500); ok(await ev(p, () => !document.querySelector('#pStats').hidden), 'stats overlay'); await key('d');
    await key('Escape', 1, 800);
    ok(await ev(p, () => !vysielac.P.open || vysielac.P.mini), 'Back leaves player', await ev(p, () => vysielac.P.mini ? 'mini' : 'closed'));
    if (await ev(p, () => vysielac.P.mini)) { await key('p', 1, 600); ok(await ev(p, () => vysielac.P.open && !vysielac.P.mini), 'P returns from mini'); await key('Escape', 1, 600); }
    if (await ev(p, () => vysielac.P.open)) { await ev(p, () => vysielac.closePlayer ? vysielac.closePlayer() : null); }
    // guide by keys
    await click(p, '.nav-item[data-screen=guide]'); await sleep(800);
    for (let i = 0; i < 6 && ((await cur()) || {}).act !== 'prog'; i++) await key('ArrowDown');
    c = await cur(); ok(c && c.act === 'prog' && c.vis, 'arrows reach guide programmes', JSON.stringify(c));
    lost = 0; for (const k of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowUp']) { await key(k, 1, 650); const x = await cur(); if (!x || !x.vis) { lost++; console.log('    lost after', k, JSON.stringify(x), await ev(p, () => { const c = document.querySelector('.focus'); if (!c) return 'none'; const r = c.getBoundingClientRect(), s = document.querySelector('#gScroll').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom, 'sc', s.top, s.bottom, innerHeight].map(Math.round).join(','); })); } }
    ok(lost === 0, 'guide focus stays visible while moving', lost);
    const det = await ev(p, () => document.querySelector('#gDetail').textContent.trim().slice(0, 40)); ok(det.length > 3, 'guide detail follows focus', det);
    await p.screenshot({ path: `tv${w}-guide.png` });
    // settings by keys: toggle one option
    await click(p, '.nav-item[data-screen=settings]'); await sleep(500); await key('Escape'); await key('ArrowDown', 2);
    lost = 0; for (let i = 0; i < 25; i++) { await key('ArrowDown', 1, 250); const x = await cur(); if (!x || !x.vis) lost++; }
    ok(lost === 0, 'settings: focus visible scrolling down', lost);
    await p.screenshot({ path: `tv${w}-settings.png` });
    // tv specific settings hidden? (no haptic/swipe on TV)
    const hidden = await ev(p, () => ['haptic', 'swipe', 'pipAuto'].filter(k => document.querySelector(`[data-act=set][data-k=${k}]`)));
    ok(hidden.length === 0, 'phone-only settings hidden on TV', hidden.join(','));
    // overflow
    for (const s of ['home', 'channels', 'guide', 'search', 'settings', 'recs']) { await click(p, `.nav-item[data-screen=${s}]`); await sleep(300); const ow = await ev(p, () => document.documentElement.scrollWidth - innerWidth); if (ow > 0) ok(false, `overflow on ${s}`, ow); }
    console.log('  errors', errs.length ? errs : 'none'); if (errs.length) ok(false, 'no page errors');
    await ctx.close();
  }
  console.log(fails() ? `FAILS: ${fails()}` : 'ALL OK');
  await b.close();
})();
