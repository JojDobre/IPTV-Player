// Google Play graphics from the demo mode (made-up channels, no real broadcasters):
//   npm run build && npm start   (in another terminal)   then   node tools/store-shots.cjs
// Writes store/phone-*.png (1080×1920), store/tv-*.png (1920×1080) and store/feature-1024x500.png.
// The demo channels have no video, so a drawn landscape stands in for the picture.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const out = path.join(__dirname, '..', 'store');
const URL = process.env.APP_URL || 'http://localhost:8080/';
fs.mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const scene = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b2a6b"/><stop offset=".55" stop-color="#e2726b"/><stop offset="1" stop-color="#ffc68a"/></linearGradient>
<radialGradient id="sun" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff6d8"/><stop offset=".4" stop-color="#ffd9a0"/><stop offset="1" stop-color="#ffd9a0" stop-opacity="0"/></radialGradient></defs>
<rect width="1600" height="900" fill="url(#sky)"/><circle cx="1050" cy="560" r="260" fill="url(#sun)"/>
<path d="M0 600 L180 430 L330 540 L520 330 L700 520 L860 400 L1040 560 L1240 380 L1420 500 L1600 420 V900 H0Z" fill="#4b3f7a"/>
<path d="M0 690 L220 560 L420 650 L640 520 L860 640 L1080 560 L1300 660 L1600 560 V900 H0Z" fill="#30295a"/>
<path d="M0 780 C300 700 520 760 800 720 S1300 690 1600 740 V900 H0Z" fill="#1c1838"/>
<path d="M0 860 C380 800 900 840 1600 820 V900 H0Z" fill="#100d22"/></svg>`;
const sceneUrl = 'data:image/svg+xml;base64,' + Buffer.from(scene).toString('base64');
const css = `#player #video, #player .demo-tag { display: none !important; }
#player .stage { background: #000 url("${sceneUrl}") center / cover no-repeat !important; }
#toast { display: none !important; }
#navRecs { display: none !important; }`;   /* recording is a PC feature; these pictures are for the Android app */

const mode = { touch: false, tv: false };
async function setMode(p) {
  await p.evaluate(m => { document.body.classList.toggle('touch', m.touch); document.documentElement.classList.toggle('tv', m.tv); }, mode);
}
async function open(ctx) {
  const p = await ctx.newPage();
  await p.goto(URL); await sleep(1800);
  await setMode(p);
  await p.addStyleTag({ content: css });
  await p.evaluate(() => { const t = document.querySelector('#toast'); if (t) t.classList.remove('on'); });
  return p;
}
const act = (p, sel) => p.evaluate(s => document.querySelector(s).click(), sel);
// Tune by typing the channel number, like on a remote.
async function play(p, name) {
  const n = await p.evaluate(nm => vysielac.channels.find(x => x.name === nm).n, name);
  for (const d of String(n)) await p.evaluate(k => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })), d);
  await sleep(1700);
  await setMode(p);   // a key press switches the app to keyboard mode
}

(async () => {
  const b = await chromium.launch();

  mode.touch = true;
  // Phone, upright: 412×732 CSS px at 2.625 → 1081×1921
  const phone = await b.newContext({ viewport: { width: 412, height: 732 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true });
  let p = await open(phone);
  await p.screenshot({ path: `${out}/phone-1-home.png` });
  await act(p, '.nav-item[data-screen=guide]'); await sleep(1200);
  await p.screenshot({ path: `${out}/phone-3-guide.png` });
  await act(p, '.nav-item[data-screen=home]'); await sleep(800);
  await play(p, 'Kino Max'); await sleep(1500);
  await p.screenshot({ path: `${out}/phone-2-player.png` });
  await p.touchscreen.tap(200, 100); await sleep(500);
  await p.screenshot({ path: `${out}/phone-4-controls.png` });
  await act(p, '#ppActs [data-act=p-audio]'); await sleep(600);
  await p.screenshot({ path: `${out}/phone-5-audio.png` });
  await p.close();
  p = await open(phone);
  await act(p, '.nav-item[data-screen=search]'); await sleep(300);
  await p.fill('#q', 'správy'); await sleep(1500);
  await p.screenshot({ path: `${out}/phone-6-search.png` });
  await p.close();

  // Phone on its side: player with controls (16:9)
  const land = await b.newContext({ viewport: { width: 732, height: 412 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true });
  p = await open(land);
  await play(p, 'Šport Live 1'); await sleep(1500);
  await p.touchscreen.tap(360, 200); await sleep(600);
  await p.screenshot({ path: `${out}/phone-7-landscape.png` });
  await p.close();

  mode.touch = false; mode.tv = true;
  // TV, 1920×1080
  const tv = await b.newContext({ viewport: { width: 1920, height: 1080 } });
  p = await open(tv);
  await p.keyboard.press('ArrowDown'); await sleep(400);
  await p.screenshot({ path: `${out}/tv-1-home.png` });
  await act(p, '.nav-item[data-screen=guide]'); await sleep(1200);
  await p.keyboard.press('ArrowDown'); await sleep(300); await p.keyboard.press('ArrowDown'); await sleep(300);
  await p.screenshot({ path: `${out}/tv-2-guide.png` });
  await act(p, '.nav-item[data-screen=home]'); await sleep(800);
  await play(p, 'Príroda'); await sleep(1500);
  await p.keyboard.press('Enter'); await sleep(600);
  await p.screenshot({ path: `${out}/tv-3-player.png` });
  await p.keyboard.press('Escape'); await sleep(300);
  await p.keyboard.press('ArrowLeft'); await sleep(700);
  await p.screenshot({ path: `${out}/tv-4-channels.png` });
  await p.close();

  // Feature graphic 1024×500
  const fg = await b.newContext({ viewport: { width: 1024, height: 500 } });
  p = await fg.newPage();
  const shot = fs.readFileSync(`${out}/tv-1-home.png`).toString('base64');
  const font = fs.readFileSync(path.join(__dirname, '..', 'node_modules/@fontsource/unbounded/files/unbounded-latin-800-normal.woff2')).toString('base64');
  await p.setContent(`<!doctype html><style>@font-face{font-family:U;src:url(data:font/woff2;base64,${font});font-weight:800}
    body{margin:0;width:1024px;height:500px;overflow:hidden;background:radial-gradient(120% 120% at 0% 0%,#2b1f6e,#07070d 60%);font-family:system-ui,sans-serif;color:#fff}
    .shot{position:absolute;right:-60px;top:70px;width:640px;border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.08);transform:perspective(1200px) rotateY(-14deg)}
    .t{position:absolute;left:64px;top:150px;width:420px}
    .logo{display:flex;align-items:center;gap:16px;font-family:U;font-weight:800;font-size:44px;letter-spacing:-.02em}
    .m{width:64px;height:64px;border-radius:18px;display:grid;place-items:center;background:linear-gradient(135deg,#7C5CFF,#4F7BFF 52%,#2EC5FF);font-size:30px}
    p{font-size:24px;line-height:1.35;color:#c9c9e6;margin:22px 0 0}</style>
    <img class="shot" src="data:image/png;base64,${shot}"><div class="t"><div class="logo"><span class="m">V</span>vysielač</div><p>Tvoj IPTV playlist ako moderná televízia. Na mobile, tablete aj TV.</p></div>`);
  await sleep(400);
  await p.screenshot({ path: `${out}/feature-1024x500.png` });
  await b.close();
  console.log('store graphics in', out);
})();
