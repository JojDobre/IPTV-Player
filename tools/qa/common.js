const { chromium, devices } = require(process.env.PLAYWRIGHT || 'playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const ok = (cond, msg, extra = '') => { if (!cond) fails++; console.log((cond ? '  ok   ' : '  FAIL ') + msg + (extra !== '' ? ' — ' + extra : '')); };
async function setup(p, url = 'http://localhost:8080/') {
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|MEDIA|DEMUXER|decode/i.test(m.text())) errs.push('console: ' + m.text()); });
  await p.goto(url); await sleep(1200);
  return errs;
}
const ev = (p, f, a) => p.evaluate(f, a);
const click = (p, s) => p.evaluate(s => { const e = document.querySelector(s); if (e) e.click(); return !!e; }, s);
async function addPlaylist(p, url = 'http://127.0.0.1:9001/playlist.m3u') {
  // skip the tour
  for (let i = 0; i < 10 && await p.$('#dialog .tour'); i++) { await p.keyboard.press('Escape'); await sleep(200); }
  await click(p, '.nav-item[data-screen=settings]'); await sleep(300);
  await click(p, '[data-act=playlist]'); await sleep(300);
  await p.fill('#plName', 'Test'); await p.fill('#plUrl', url);
  await click(p, '[data-act=save-playlist]');
  await p.waitForFunction(() => /Program načítaný|Guide loaded|nepodarilo|could not/.test(document.querySelector('#libStatusTxt')?.textContent || ''), null, { timeout: 30000 });
}
module.exports = { chromium, devices, sleep, ok, setup, ev, click, addPlaylist, fails: () => fails };
