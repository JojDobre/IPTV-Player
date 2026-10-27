// Google Play graphics from the demo mode (made-up channels, no real broadcasters):
//   npm run build && npm start   (in another terminal)   then   node tools/store-shots.cjs
// Takes fresh screenshots of the app and puts each one in a store picture with a headline:
//   store/<sk|en>/phone-1…6.png (1080×1920), phone-7-landscape.png, tv-1…4.png (1920×1080), feature-1024x500.png
// The demo channels have no video, so a drawn landscape stands in for the picture.
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..', 'store');
const URL = process.env.APP_URL || 'http://localhost:8080/?demo';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const b64 = f => fs.readFileSync(f).toString('base64');
const fontFile = n => path.join(__dirname, '..', 'node_modules/@fontsource', n);

// Headline and the line under it, per picture and language.
const TEXT = {
  sk: {
    'phone-1': ['Celá tvoja televízia', 'Obľúbené kanály, kategórie a čo práve beží'],
    'phone-2': ['Obraz hore, kanály pod ním', 'Prepínaj kanály jedným ťuknutím'],
    'phone-3': ['TV program po dňoch', 'Priblížiš ho dvoma prstami'],
    'phone-4': ['Pauza aj pretáčanie', 'Živé vysielanie, archív a pozeranie od začiatku'],
    'phone-5': ['Zvuk a titulky podľa teba', 'Jazyk stopy si appka zapamätá'],
    'phone-6': ['Nájdi kanál aj reláciu', 'Hľadá v celom TV programe'],
    'phone-7': ['Na šírku na celú obrazovku', 'Veľké tlačidlá, dvojité ťuknutie = ±30 s'],
    'tv-1': ['Pre Android TV a ovládač', 'Šípky, OK, čísla kanálov a CH+ / CH−'],
    'tv-2': ['Celý program prehľadne', 'Archív, pripomienky a pozeranie od začiatku'],
    'tv-3': ['Plynulé prehrávanie', 'Natívny prehrávač, obraz prepnutý na 50 Hz'],
    'tv-4': ['Kanály vždy po ruke', 'Šípka doľava a vyberáš ďalší kanál'],
    feature: 'Tvoj IPTV playlist ako moderná televízia. Na mobile, tablete aj TV.',
  },
  en: {
    'phone-1': ['All your TV in one place', 'Favourites, categories and what is on now'],
    'phone-2': ['Picture on top, channels below', 'Switch channels with a single tap'],
    'phone-3': ['TV guide by day', 'Pinch with two fingers to zoom'],
    'phone-4': ['Pause and rewind', 'Live TV, catch-up and start from the beginning'],
    'phone-5': ['Your audio, your subtitles', 'The app remembers your language'],
    'phone-6': ['Find channels and shows', 'Searches the whole guide'],
    'phone-7': ['Full screen in landscape', 'Big buttons, double-tap = ±30 s'],
    'tv-1': ['Made for Android TV', 'Arrows, OK, channel numbers and CH+ / CH−'],
    'tv-2': ['The whole guide at a glance', 'Catch-up, reminders and start from the beginning'],
    'tv-3': ['Smooth playback', 'Native player, screen switched to 50 Hz'],
    'tv-4': ['Channels always at hand', 'Press left and pick the next channel'],
    feature: 'Your IPTV playlist as a modern TV. On phones, tablets and TV.',
  },
};

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

let lang = 'sk';
const mode = { touch: false, tv: false };
async function setMode(p) {
  await p.evaluate(m => { document.body.classList.toggle('touch', m.touch); document.documentElement.classList.toggle('tv', m.tv); }, mode);
}
async function open(ctx, statusBar) {
  const p = await ctx.newPage();
  await p.addInitScript(l => { localStorage.setItem('vysielac2:settings3', JSON.stringify({ ui: l })); localStorage.setItem('vysielac2:tour', '1'); }, lang);
  await p.goto(URL); await sleep(1800);
  await setMode(p);
  await p.addStyleTag({ content: css });
  // Room for the phone's status bar, drawn into the frame later.
  if (statusBar) await p.evaluate(() => document.documentElement.style.setProperty('--sa-t', '28px'));
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

// ---------- composing the store pictures ----------
const fonts = `@font-face{font-family:O;font-weight:800;src:url(data:font/woff2;base64,${b64(fontFile('onest/files/onest-latin-800-normal.woff2'))})}
@font-face{font-family:O;font-weight:800;src:url(data:font/woff2;base64,${b64(fontFile('onest/files/onest-latin-ext-800-normal.woff2'))});unicode-range:U+0100-024F}
@font-face{font-family:O;font-weight:500;src:url(data:font/woff2;base64,${b64(fontFile('onest/files/onest-latin-500-normal.woff2'))})}
@font-face{font-family:O;font-weight:500;src:url(data:font/woff2;base64,${b64(fontFile('onest/files/onest-latin-ext-500-normal.woff2'))});unicode-range:U+0100-024F}
@font-face{font-family:U;font-weight:800;src:url(data:font/woff2;base64,${b64(fontFile('unbounded/files/unbounded-latin-800-normal.woff2'))})}`;
const MARK = s => `<svg viewBox="0 0 100 100" width="${s}" height="${s}"><g fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round"><path d="M66.97 33.03a24 24 0 0 1 0 33.94M33.03 66.97a24 24 0 0 1 0-33.94M76.87 23.13a38 38 0 0 1 0 53.74M23.13 76.87a38 38 0 0 1 0-53.74"/></g><circle cx="50" cy="50" r="10" fill="#fff"/></svg>`;
const LOGO = (s, fs) => `<div class="logo" style="font-size:${fs}px"><span class="m" style="width:${s}px;height:${s}px;border-radius:${s * 0.28}px">${MARK(s * 0.78)}</span>OnAir</div>`;
// A slightly different glow behind every picture, so the set does not look copy-pasted.
const GLOWS = ['#5b3df5', '#2f6bff', '#b8379a', '#1f8fd6', '#6d3df0', '#d2475c', '#3a56e0'];
const base = (w, h, i) => `${fonts}
html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;color:#fff;font-family:O,sans-serif;
  background:radial-gradient(90% 60% at 50% 0%, ${GLOWS[i % GLOWS.length]}cc, transparent 70%), radial-gradient(80% 60% at 100% 100%, #1b2a6b, transparent 70%), #07070d}
.logo{display:flex;align-items:center;gap:.4em;font-family:U;font-weight:800;letter-spacing:-.03em}
.m{display:grid;place-items:center;background:linear-gradient(135deg,#7C5CFF,#4F7BFF 52%,#2EC5FF);box-shadow:inset 0 1px 0 rgba(255,255,255,.4)}
h1{font-weight:800;letter-spacing:-.025em;line-height:1.05;margin:0;text-wrap:balance}
p{font-weight:500;color:#cfd2f2;margin:0;line-height:1.3;text-wrap:balance}
.dev{position:absolute;background:#0b0b12;box-shadow:0 40px 120px rgba(0,0,0,.65),0 0 0 2px rgba(255,255,255,.12)}
.dev img{display:block;width:100%;height:100%;object-fit:cover;object-position:top}`;
// The phone's status bar over the top 28 CSS px of the screenshot.
const statusBar = (h, fs) => `<div style="position:absolute;left:0;right:0;top:0;height:${h}px;display:flex;align-items:center;justify-content:space-between;padding:0 ${fs * 1.6}px;font:600 ${fs}px O,sans-serif;color:#fff;box-sizing:border-box">
  <span>${new Date().toTimeString().slice(0, 5)}</span><span style="display:flex;gap:${fs * 0.4}px;align-items:center">
  <svg width="${fs * 1.2}" height="${fs}" viewBox="0 0 12 10"><path d="M0 10h2V7H0zM3.3 10h2V5h-2zM6.6 10h2V2.5h-2zM10 10h2V0h-2z" fill="#fff"/></svg>
  <svg width="${fs * 1.9}" height="${fs}" viewBox="0 0 19 10"><rect x=".5" y=".5" width="16" height="9" rx="2.2" fill="none" stroke="#fff"/><rect x="2" y="2" width="11" height="6" rx="1" fill="#fff"/><rect x="17.4" y="3.2" width="1.4" height="3.6" rx=".6" fill="#fff"/></svg></span></div>`;

async function compose(b, kind, raw, out, i) {
  const [title, sub] = TEXT[lang][kind];
  const img = `data:image/png;base64,${b64(raw)}`;
  let w, h, body;
  if (kind.startsWith('phone') && kind !== 'phone-7') {
    // Upright phone that runs off the bottom edge; the headline above it.
    w = 1080; h = 1920;
    const dw = 860, dh = Math.round(dw * 870 / 412), r = 70, bz = 16, sb = Math.round(28 * dw / 412);
    body = `<div style="position:absolute;left:0;right:0;top:110px;text-align:center;padding:0 70px"><h1 style="font-size:80px">${title}</h1><p style="font-size:40px;margin-top:22px">${sub}</p></div>
      <div class="dev" style="left:${(w - dw) / 2 - bz}px;top:410px;width:${dw}px;height:${dh}px;padding:${bz}px;border-radius:${r}px">
        <div style="position:relative;width:100%;height:100%;border-radius:${r - bz}px;overflow:hidden"><img src="${img}">${statusBar(sb, 30)}</div></div>`;
  } else if (kind === 'phone-7') {
    // Phone on its side.
    w = 1920; h = 1080;
    const dw = 1480, dh = Math.round(dw * 412 / 870), r = 64, bz = 16;
    body = `<div style="position:absolute;left:0;right:0;top:64px;text-align:center"><h1 style="font-size:72px">${title}</h1><p style="font-size:36px;margin-top:16px">${sub}</p></div>
      <div class="dev" style="left:${(w - dw) / 2 - bz}px;top:300px;width:${dw}px;height:${dh}px;padding:${bz}px;border-radius:${r}px">
        <div style="width:100%;height:100%;border-radius:${r - bz}px;overflow:hidden"><img src="${img}"></div></div>`;
  } else {
    // TV: a thin-bezel screen under the headline.
    w = 1920; h = 1080;
    const dw = 1440, dh = 810, bz = 10;
    body = `<div style="position:absolute;left:0;right:0;top:52px;text-align:center"><h1 style="font-size:68px">${title}</h1><p style="font-size:34px;margin-top:14px">${sub}</p></div>
      <div class="dev" style="left:${(w - dw) / 2 - bz}px;top:248px;width:${dw}px;height:${dh}px;padding:${bz}px;border-radius:18px">
        <div style="width:100%;height:100%;border-radius:8px;overflow:hidden"><img src="${img}"></div></div>`;
  }
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  const p = await ctx.newPage();
  await p.setContent(`<!doctype html><style>${base(w, h, i)}</style>${body}`);
  await p.evaluate(() => document.fonts.ready); await sleep(150);
  await p.screenshot({ path: out });
  await ctx.close();
}

(async () => {
  const b = await chromium.launch();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'store-'));
  for (lang of ['sk', 'en']) {
    const out = path.join(root, lang);
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    const raw = n => path.join(tmp, `${lang}-${n}.png`);

    mode.touch = true; mode.tv = false;
    // Phone, upright: a modern 412×870 screen at 2.625 → 1082×2284
    const phone = await b.newContext({ viewport: { width: 412, height: 870 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true });
    let p = await open(phone, true);
    await p.screenshot({ path: raw('phone-1') });
    await act(p, '.nav-item[data-screen=guide]'); await sleep(1200);
    await p.screenshot({ path: raw('phone-3') });
    await act(p, '.nav-item[data-screen=home]'); await sleep(800);
    await play(p, 'Kino Max'); await sleep(1500);
    await p.screenshot({ path: raw('phone-2') });
    await p.touchscreen.tap(200, 110); await sleep(500);
    await p.screenshot({ path: raw('phone-4') });
    await act(p, '#ppActs [data-act=p-audio]'); await sleep(700);
    await p.screenshot({ path: raw('phone-5') });
    await p.close();
    p = await open(phone, true);
    await act(p, '.nav-item[data-screen=search]'); await sleep(300);
    await p.fill('#q', lang === 'sk' ? 'správy' : 'news'); await sleep(1500);
    await p.evaluate(() => document.activeElement.blur()); await sleep(300);
    await p.screenshot({ path: raw('phone-6') });
    await p.close();

    // Phone on its side: player with controls
    const land = await b.newContext({ viewport: { width: 870, height: 412 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true });
    p = await open(land);
    await play(p, 'Šport Live 1'); await sleep(1500);
    await p.touchscreen.tap(430, 200); await sleep(600);
    await p.screenshot({ path: raw('phone-7') });
    await p.close();

    mode.touch = false; mode.tv = true;
    const tv = await b.newContext({ viewport: { width: 1920, height: 1080 } });
    p = await open(tv);
    await p.keyboard.press('ArrowDown'); await sleep(400);
    await p.screenshot({ path: raw('tv-1') });
    await act(p, '.nav-item[data-screen=guide]'); await sleep(1200);
    await p.keyboard.press('ArrowDown'); await sleep(300); await p.keyboard.press('ArrowDown'); await sleep(300);
    await p.screenshot({ path: raw('tv-2') });
    await act(p, '.nav-item[data-screen=home]'); await sleep(800);
    await play(p, 'Príroda'); await sleep(1500);
    await p.keyboard.press('Enter'); await sleep(600);
    await p.screenshot({ path: raw('tv-3') });
    await p.keyboard.press('Escape'); await sleep(300);
    await p.keyboard.press('ArrowLeft'); await sleep(700);
    await p.screenshot({ path: raw('tv-4') });
    await p.close();
    await phone.close(); await land.close(); await tv.close();

    const names = { 'phone-1': 'phone-1-home', 'phone-2': 'phone-2-player', 'phone-3': 'phone-3-guide', 'phone-4': 'phone-4-controls', 'phone-5': 'phone-5-audio', 'phone-6': 'phone-6-search', 'phone-7': 'phone-7-landscape', 'tv-1': 'tv-1-home', 'tv-2': 'tv-2-guide', 'tv-3': 'tv-3-player', 'tv-4': 'tv-4-channels' };
    let i = 0;
    for (const [k, n] of Object.entries(names)) await compose(b, k, raw(k), `${out}/${n}.png`, i++);

    // Feature graphic 1024×500
    const fg = await b.newContext({ viewport: { width: 1024, height: 500 } });
    p = await fg.newPage();
    await p.setContent(`<!doctype html><style>${base(1024, 500, 0)}
      body{background:radial-gradient(120% 120% at 0% 0%,#2b1f6e,#07070d 60%)}
      .shot{position:absolute;right:-60px;top:70px;width:640px;border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.08);transform:perspective(1200px) rotateY(-14deg)}
      .t{position:absolute;left:64px;top:150px;width:420px}</style>
      <img class="shot" src="data:image/png;base64,${b64(raw('tv-1'))}"><div class="t">${LOGO(64, 46)}<p style="font-size:24px;margin-top:22px">${TEXT[lang].feature}</p></div>`);
    await p.evaluate(() => document.fonts.ready); await sleep(300);
    await p.screenshot({ path: `${out}/feature-1024x500.png` });
    await fg.close();
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  await b.close();
  console.log('store graphics in', root);
})();
