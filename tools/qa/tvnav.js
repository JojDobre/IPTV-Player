const { chromium, sleep, ok, setup, ev, click, fails } = require('./common');
const UA = 'Mozilla/5.0 (Linux; Android 12; BRAVIA 4K Android TV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
(async () => {
  const b = await chromium.launch();
  for (const [w, h] of [[1920, 1080], [1280, 720]]) {
    console.log(`# ${w}x${h}`);
    const ctx = await b.newContext({ viewport: { width: w, height: h }, userAgent: UA, locale: 'en-US' });
    await ctx.addInitScript(() => localStorage.setItem('vysielac2:tour', '1'));
    const p = await ctx.newPage(); const errs = await setup(p, 'http://localhost:8080/?demo'); await sleep(600);
    const key = async (k, d = 280) => { await p.keyboard.press(k); await sleep(d); };
    const where = () => ev(p, () => { const c = document.querySelector('.focus'); if (!c) return null; const r = c.getBoundingClientRect();
      const row = c.closest('.sec, #hero, #pills, .set-row, .set-group, #topnav, .chips, .welcome');
      return { act: c.dataset.act, row: row ? (row.id || row.querySelector('h3,b,.lbl b')?.textContent || row.className).slice(0, 40) : '?', top: Math.round(r.top + scrollY), docTop: Math.round(c.getBoundingClientRect().top + (document.querySelector('#s-' + vysielac.S.screen)?.scrollTop || 0)), left: Math.round(r.left), nav: !!c.closest('#topnav') }; });
    // ---- home: down through every row
    for (let i = 0; i < 5 && !(await where()); i++) await key('ArrowDown', 500);
    let prev = await where(), rows = [prev.row], sideways = 0, stuck = 0;
    for (let i = 0; i < 40; i++) {
      await key('ArrowDown');
      const cur = await where();
      if (!cur || cur.docTop === prev.docTop && cur.row === prev.row && cur.left === prev.left) { stuck++; if (stuck > 1) break; continue; }
      if (cur.docTop <= prev.docTop + 2 && !(cur.row === prev.row && Math.abs(cur.left - prev.left) < 4)) { sideways++; console.log('    sideways/up:', JSON.stringify(prev), '→', JSON.stringify(cur)); }
      if (cur.row !== rows[rows.length - 1]) rows.push(cur.row);
      prev = cur;
    }
    const secCount = await ev(p, () => document.querySelectorAll('#sections .sec').length);
    ok(sideways === 0, 'home: Down always goes to a lower row', sideways);
    ok(rows.filter(r => r !== 'hero' && r !== 'pills').length >= secCount, 'home: Down reaches every category', `${rows.length} rows: ${rows.join(' | ')}`);
    // ---- right stays in the row, up never enters the top menu
    await click(p, '.nav-item[data-screen=home]'); await sleep(400); await key('Escape'); await key('ArrowDown'); await key('ArrowDown'); await key('ArrowDown');
    const r0 = await where(); let leftRow = 0;
    for (let i = 0; i < 6; i++) { await key('ArrowRight'); const c = await where(); if (Math.abs(c.docTop - r0.docTop) > 4) leftRow++; }
    ok(leftRow === 0, 'home: Right stays in the same row', leftRow);
    let navHit = false; for (let i = 0; i < 12; i++) { await key('ArrowUp'); if ((await where()).nav) navHit = true; }
    ok(!navHit, 'home: Up never goes into the top menu');
    await key('Escape'); ok((await where()).nav, 'Back goes to the top menu');
    await key('ArrowDown'); ok(!(await where()).nav, 'Down from the top menu goes back to the content');
    // ---- settings: Down visits rows in order
    await click(p, '.nav-item[data-screen=settings]'); await sleep(500); await key('ArrowDown');
    prev = await where(); let back = 0; const seen = new Set([prev.row]);
    for (let i = 0; i < 70; i++) { await key('ArrowDown', 160); const c = await where(); if (!c) break; if (c.docTop < prev.docTop - 2) { back++; console.log('    settings up:', JSON.stringify(prev), '→', JSON.stringify(c)); } seen.add(c.row); prev = c; }
    const total = await ev(p, () => [...document.querySelectorAll('#settings .set-row')].filter(r => r.querySelector('.f')).length);
    ok(back === 0, 'settings: Down never jumps back up', back);
    ok(seen.size >= total - 1, 'settings: Down visits every row', `${seen.size} of ${total}`);
    // left/right inside a segmented control
    await click(p, '.nav-item[data-screen=settings]'); await sleep(300); await p.evaluate(() => document.querySelector('#s-settings').scrollTop = 0); for (let i = 0; i < 40; i++) await key('ArrowUp', 90); await sleep(400);
    const s0 = await where(); await key('ArrowLeft'); const s1 = await where(); await key('ArrowLeft'); const s2 = await where(); await key('ArrowLeft'); const s3 = await where();
    ok(s0.row === s2.row && s2.left < s0.left && s3.left === s2.left, 'settings: Left moves inside the row and stops at its end', `${s0.row} ${s0.left}→${s1.left}→${s2.left}→${s3.left}`);
    console.log('  errors', errs.length ? errs : 'none');
    await ctx.close();
  }
  console.log(fails() ? `FAILS: ${fails()}` : 'ALL OK'); await b.close();
})();
