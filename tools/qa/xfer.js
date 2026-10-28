const { chromium, sleep, ok, setup, ev, click, addPlaylist, fails } = require('./common');
const PORT = process.argv[2];
// The Android app in a desktop browser: Capacitor bridge with LocalRelay (Java relay on PORT) and a fake QR scanner.
const nativeMock = port => {
  const listeners = {};
  const LocalRelay = { async info() { return { port, tv: false, sdk: 34, pip: true }; }, async playing() {}, async exit() {}, async orientation() {}, async pip() {}, async pipNow() {}, async haptic() {},
    async scanQr() { if (!window.__scan) throw Object.assign(new Error('canceled'), { code: 'CANCELED' }); return { value: window.__scan }; } };
  const NativePlayer = { addListener(ev, f) { (listeners[ev] ||= []).push(f); return Promise.resolve({ remove() {} }); }, async open() {}, async stop() {}, async layout() {}, async volume() {}, async track() {}, async seek() {}, async live() {}, async play() {}, async pause() {} };
  const impl = { NativePlayer, LocalRelay };
  const hdr = name => ({ name, methods: [...Object.keys(impl[name]).filter(k => k !== 'addListener').map(k => ({ name: k, rtype: 'promise' })), { name: 'addListener', rtype: 'callback' }, { name: 'removeListener', rtype: 'promise' }] });
  window.androidBridge = { postMessage() {} };
  window.Capacitor = { PluginHeaders: [hdr('NativePlayer'), hdr('LocalRelay')], nativePromise: (pl, m, o) => impl[pl][m](o), nativeCallback: (pl, m, o, cb) => { (listeners[o.eventName] ||= []).push(cb); return 'cb'; } };
};
const names = p => ev(p, () => vysielac.S.order.map(id => vysielac.channels.find(c => c.id === id).name));
const cats = p => ev(p, () => vysielac.S.sections.filter(s => s.custom).map(s => s.name + ':' + s.chs.length));
(async () => {
  const b = await chromium.launch();
  // B: the PC with its own arrangement
  const B = await (await b.newContext({ viewport: { width: 1280, height: 800 }, locale: 'sk-SK' })).newPage();
  const errs = await setup(B); await addPlaylist(B);
  await ev(B, () => {
    const o = JSON.parse(localStorage.getItem('vysielac2:order:pl')) || vysielac.S.order.slice();
    const moved = o.splice(5, 3); o.unshift(...moved.reverse());                       // three channels to the top
    localStorage.setItem('vysielac2:order:pl', JSON.stringify(o));
    const secs = JSON.parse(JSON.stringify(vysielac.S.sections));
    secs.push({ id: 'my1', type: 'cat', custom: true, name: 'Moje', color: '#f00', icon: 'heart', show: true, chs: o.slice(10, 14) });
    secs.find(s => s.id === 'fav').chs = o.slice(20, 22);
    localStorage.setItem('vysielac2:sections:pl', JSON.stringify(secs));
  });
  await B.reload(); await B.waitForFunction(() => vysielac.channels.length > 100, null, { timeout: 30000 }); await sleep(800);
  const bNames = await names(B), bCats = await cats(B), bFav = await ev(B, () => vysielac.S.sections.find(s => s.id === 'fav').chs.length);
  ok(bNames.length > 100 && bCats.length === 1, 'PC arrangement prepared', `${bNames.slice(0, 3).join(', ')} … ${bCats}`);
  await click(B, '.nav-item[data-screen=settings]'); await sleep(300);
  ok(await click(B, '[data-act=xfer]'), 'Transfer button in settings'); await sleep(300);
  ok(!(await B.$('[data-act=xfer-scan]')), 'no scan option on PC');
  const shareResp = B.waitForResponse(r => r.url().includes('/api/share-start'));
  await click(B, '[data-act=xfer-send]');
  const info = await (await shareResp).json(); await sleep(500);
  ok(info.urls && info.urls[0] && await B.$('#dialog .pair-qr svg'), 'PC shows QR to send', info.urls[0]);
  await B.screenshot({ path: 'x-send.png' });

  // A: phone app, empty, scans the PC code
  const actx = await b.newContext({ viewport: { width: 412, height: 860 }, locale: 'sk-SK', hasTouch: true, isMobile: true });
  await actx.addInitScript(nativeMock, PORT);
  const A = await actx.newPage(); const aerr = await setup(A, 'http://localhost:8099/');
  for (let i = 0; i < 8 && await A.$('#dialog .tour'); i++) { await A.keyboard.press('Escape'); await sleep(150); }
  ok(await ev(A, () => vysielac.channels.length) === 0, 'phone starts empty');
  await click(A, '.nav-item[data-screen=settings]'); await sleep(300); await click(A, '[data-act=xfer]'); await sleep(300);
  ok(!!(await A.$('[data-act=xfer-scan]')), 'phone offers Scan QR');
  await A.screenshot({ path: 'x-dialog.png' });
  // the first address in the code is unreachable (like a virtual adapter on a Windows PC); the real one is an alternative
  const bad = info.urls[0].replace(/\/\/[^/]+/, '//10.255.255.1:8080') + '&alt=' + new URL(info.urls[0]).host;
  await ev(A, u => { window.__scan = u; }, bad);
  await click(A, '[data-act=xfer-scan]'); await sleep(7500);
  ok(await A.$('[data-act=xfer-take]'), 'phone asks to take over', (await A.textContent('#dialog')).replace(/\s+/g, ' ').slice(0, 140));
  await A.screenshot({ path: 'x-confirm.png' });
  await click(A, '[data-act=xfer-take]');
  await A.waitForFunction(() => vysielac.channels.length > 100, null, { timeout: 30000 }).catch(() => {}); await sleep(1500);
  const aNames = await names(A);
  ok(JSON.stringify(aNames) === JSON.stringify(bNames), 'phone has the same channels in the same order', `${aNames.length} vs ${bNames.length}; ${aNames.slice(0, 3).join(', ')}`);
  ok(JSON.stringify(await cats(A)) === JSON.stringify(bCats), 'custom category arrived', await cats(A));
  ok(await ev(A, () => vysielac.S.sections.find(s => s.id === 'fav').chs.length) === bFav, 'favourites arrived');

  // C: another empty device waits ("Receive here"), the phone scans it and pushes
  const C = await (await b.newContext({ viewport: { width: 1280, height: 800 }, locale: 'sk-SK' })).newPage();
  await setup(C);
  for (let i = 0; i < 8 && await C.$('#dialog .tour'); i++) { await C.keyboard.press('Escape'); await sleep(150); }
  await click(C, '.nav-item[data-screen=settings]'); await sleep(300); await click(C, '[data-act=xfer]'); await sleep(300);
  const pairResp = C.waitForResponse(r => r.url().includes('/api/pair-start'));
  await click(C, '[data-act=xfer-recv]');
  const pinfo = await (await pairResp).json(); await sleep(500);
  await C.screenshot({ path: 'x-recv.png' });
  await click(A, '[data-act=xfer]'); await sleep(300);
  await ev(A, u => { window.__scan = u; }, pinfo.urls[0] + '&m=s');
  await click(A, '[data-act=xfer-scan]'); await sleep(1000);
  await C.waitForFunction(() => vysielac.channels.length > 100, null, { timeout: 40000 }).catch(() => {}); await sleep(1500);
  const cNames = await names(C);
  ok(JSON.stringify(cNames) === JSON.stringify(bNames), 'pushed from phone: same order on the third device', `${cNames.length}`);
  ok(JSON.stringify(await cats(C)) === JSON.stringify(bCats), 'custom category on the third device');
  // a camera app opening the receive code gets a hint, not the playlist form
  const phoneBrowser = await (await b.newContext({ locale: 'sk-SK' })).newPage();
  const pi2 = await (await fetch('http://localhost:8080/api/pair-start')).json();
  await phoneBrowser.goto(pi2.urls[0] + '&m=s'); await sleep(300);
  ok(/patrí do appky OnAir/.test(await phoneBrowser.textContent('h1')) && await phoneBrowser.$eval('#f', f => f.hidden), 'camera app gets a hint page');
  // garbage QR
  await click(A, '[data-act=xfer]'); await sleep(200); await ev(A, () => { window.__scan = 'https://example.com/x'; });
  await click(A, '[data-act=xfer-scan]'); await sleep(500);
  ok(/nie je z appky OnAir|not from OnAir/.test(await A.textContent('#toast')), 'foreign QR rejected');
  // nothing reachable: a dialog with what to check
  await A.keyboard.press('Escape'); await sleep(300);
  await click(A, '[data-act=xfer]'); await sleep(200); await ev(A, () => { window.__scan = 'http://10.255.255.1:8080/share?t=x&alt=10.255.255.2:8080'; });
  await click(A, '[data-act=xfer-scan]'); await sleep(12000);
  ok(/does not answer|neodpovedá/.test(await A.textContent('#dialog h2')) && /10\.255\.255\.1:8080, 10\.255\.255\.2:8080/.test(await A.textContent('#dialog')), 'unreachable: help dialog with the tried addresses');
  await A.screenshot({ path: 'x-unreachable.png' });
  console.log('errors', [...errs, ...aerr]);
  console.log(fails() ? `FAILS: ${fails()}` : 'ALL OK');
  await b.close();
})();
