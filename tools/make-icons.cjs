// Renders the app icon, Android launcher icons, splash screens and the Android TV banner from one design
// (the on-air mark of the header: a dot with broadcast waves).
//   node tools/make-icons.cjs        (needs Playwright with Chromium)
// Writes into android/app/src/main/res and store/ (Google Play icon 512×512).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const res = path.join(root, 'android/app/src/main/res');
// Inlined: a page set with setContent() may not load file:// fonts.
const font = 'data:font/woff2;base64,' + fs.readFileSync(path.join(root, 'node_modules/@fontsource/unbounded/files/unbounded-latin-800-normal.woff2')).toString('base64');
const GRAD = 'linear-gradient(135deg, #7C5CFF 0%, #4F7BFF 52%, #2EC5FF 100%)';
// Same drawing as #i-onair in index.html. s = size in px.
const MARK = s => `<svg viewBox="0 0 100 100" width="${s}" height="${s}" style="filter:drop-shadow(0 ${s * 0.02}px ${s * 0.05}px rgba(20,10,80,.3))"><g fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round"><path d="M66.97 33.03a24 24 0 0 1 0 33.94M33.03 66.97a24 24 0 0 1 0-33.94M76.87 23.13a38 38 0 0 1 0 53.74M23.13 76.87a38 38 0 0 1 0-53.74"/></g><circle cx="50" cy="50" r="10" fill="#fff"/></svg>`;

// kind: full (rounded square), round (circle), fg (white mark only, adaptive foreground), splash (dark screen, centred icon),
// banner (Android TV launcher: icon + name)
const page = (kind, w, h) => `<!doctype html><html><head><style>
@font-face { font-family: U; src: url(${font}); font-weight: 800; }
html, body { margin: 0; width: ${w}px; height: ${h}px; background: ${kind === 'splash' ? '#07070D' : 'transparent'}; }
.box { position: absolute; display: grid; place-items: center; overflow: hidden; }
.mark { font-family: U; font-weight: 800; color: #fff; line-height: 1; transform: translateY(2%); text-shadow: 0 ${w * 0.01}px ${w * 0.03}px rgba(20, 10, 80, .25); }
.shine { position: absolute; inset: 0; background: radial-gradient(120% 80% at 20% 0%, rgba(255,255,255,.35), transparent 55%); }
</style></head><body>${(() => {
  if (kind === 'fg') return `<div class="box" style="inset:0">${MARK(w * 0.56)}</div>`;
  if (kind === 'banner') { const s = h * 0.5; return `<div style="position:absolute;inset:0;background:radial-gradient(120% 140% at 0% 0%,#2b1f6e,#07070D 65%);display:flex;align-items:center;justify-content:center;gap:${h * 0.09}px"><div class="box" style="position:relative;width:${s}px;height:${s}px;border-radius:${s * 0.26}px;background:${GRAD}"><div class="shine"></div>${MARK(s * 0.78)}</div><span class="mark" style="font-size:${h * 0.24}px;letter-spacing:-.03em">OnAir</span></div>`; }
  if (kind === 'splash') { const s = Math.min(w, h) * 0.26; return `<div class="box" style="width:${s}px;height:${s}px;left:${(w - s) / 2}px;top:${(h - s) / 2}px;border-radius:${s * 0.28}px;background:${GRAD}"><div class="shine"></div>${MARK(s * 0.78)}</div>`; }
  const r = kind === 'round' ? '50%' : `${w * 0.22}px`, pad = kind === 'store' ? 0 : w * 0.04;
  return `<div class="box" style="inset:${pad}px;border-radius:${kind === 'store' ? 0 : r};background:${GRAD}"><div class="shine"></div>${MARK(w * (kind === 'store' ? 0.74 : 0.7))}</div>`;
})()}</body></html>`;

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  const shot = async (kind, w, h, file) => {
    await p.setViewportSize({ width: w, height: h });
    await p.setContent(page(kind, w, h));
    await p.evaluate(() => document.fonts.ready);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await p.screenshot({ path: file, omitBackground: kind !== 'splash' });
  };
  const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [d, k] of Object.entries(dens)) {
    await shot('full', 48 * k, 48 * k, `${res}/mipmap-${d}/ic_launcher.png`);
    await shot('round', 48 * k, 48 * k, `${res}/mipmap-${d}/ic_launcher_round.png`);
    await shot('fg', 108 * k, 108 * k, `${res}/mipmap-${d}/ic_launcher_foreground.png`);
  }
  for (const dir of fs.readdirSync(res).filter(n => n.startsWith('drawable'))) {
    const f = `${res}/${dir}/splash.png`;
    if (!fs.existsSync(f)) continue;
    const buf = fs.readFileSync(f), w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    await shot('splash', w, h, f);
  }
  await shot('store', 512, 512, path.join(root, 'store/icon-512.png'));
  // Android TV banner 320×180 dp, drawn at xhdpi.
  await shot('banner', 640, 360, `${res}/drawable-xhdpi/banner.png`);
  await b.close();
  console.log('icons done');
})();
