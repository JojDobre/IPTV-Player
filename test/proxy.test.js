import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { handleApi, rewriteHls } from '../server/proxy.js';

let up, relay, U, R, open1 = 0, conns1 = 0;
const seen = [];
before(async () => {
  up = http.createServer((req, res) => {
    seen.push({ url: req.url, ua: req.headers['user-agent'], ref: req.headers.referer, range: req.headers.range });
    if (req.url === '/redir') { res.writeHead(302, { location: '/hls/main.m3u8' }); return res.end(); }
    if (req.url === '/hls/main.m3u8') { res.writeHead(200, { 'content-type': 'application/x-mpegURL' }); return res.end('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="SK",URI="audio/sk.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=1\nv/720.m3u8\n'); }
    if (req.url === '/plain-playlist') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('#EXTM3U\n#EXTINF:6,\nseg1.ts\n'); }
    if (req.url === '/live.ts') { res.writeHead(200, { 'content-type': 'video/mp2t' }); const b = Buffer.alloc(188 * 4, 0); for (let i = 0; i < 4; i++) b[i * 188] = 0x47; return res.end(b); }
    if (req.url === '/one') {
      // Provider allowing a single connection: a second one while the first is open gets 403.
      if (open1 > 0) { res.writeHead(403); return res.end('limit'); }
      open1++; conns1++;
      res.on('close', () => { open1--; });
      res.writeHead(200, { 'content-type': 'video/mp2t' });
      const b = Buffer.alloc(188 * 50, 0); for (let i = 0; i < 50; i++) b[i * 188] = 0x47;
      res.write(b);
      const t = setInterval(() => res.write(b), 50);
      res.on('close', () => clearInterval(t));
      return;
    }
    if (req.url === '/file') { res.writeHead(206, { 'content-range': 'bytes 0-3/10', 'content-length': 4 }); return res.end('abcd'); }
    res.writeHead(404); res.end('nope');
  }).listen(0);
  relay = http.createServer(async (req, res) => { if (!(await handleApi(req, res))) { res.writeHead(404); res.end(); } }).listen(0);
  await new Promise(r => setTimeout(r, 50));
  U = `http://127.0.0.1:${up.address().port}`;
  R = `http://127.0.0.1:${relay.address().port}`;
});
after(() => { up.close(); relay.close(); });

const api = (route, url, extra = '') => fetch(`${R}/api/${route}?url=${encodeURIComponent(url)}${extra}`);

test('rewriteHls resolves relative URIs against the final URL', () => {
  const out = rewriteHls('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="k.bin"\n#EXTINF:6,\n../seg/1.ts\nhttp://cdn/x.ts\n', 'http://h/a/b/list.m3u8', '&ua=X');
  const lines = out.split('\n');
  assert.equal(lines[1], `#EXT-X-KEY:METHOD=AES-128,URI="/api/stream?url=${encodeURIComponent('http://h/a/b/k.bin')}&ua=X"`);
  assert.equal(lines[3], `/api/stream?url=${encodeURIComponent('http://h/a/seg/1.ts')}&ua=X`);
  assert.equal(lines[4], `/api/stream?url=${encodeURIComponent('http://cdn/x.ts')}&ua=X`);
});

test('stream: follows redirects, rewrites playlist, adds CORS, forwards UA and referer', async () => {
  const r = await api('stream', `${U}/redir`, '&ua=Box%2F1&ref=http%3A%2F%2Fr%2F');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.match(r.headers.get('content-type'), /mpegurl/);
  const text = await r.text();
  assert.ok(text.includes(`URI="/api/stream?url=${encodeURIComponent(U + '/hls/audio/sk.m3u8')}&ua=Box%2F1&ref=http%3A%2F%2Fr%2F"`), text);
  assert.ok(text.includes(`/api/stream?url=${encodeURIComponent(U + '/hls/v/720.m3u8')}`));
  const last = seen.find(s => s.url === '/hls/main.m3u8');
  assert.equal(last.ua, 'Box/1');
  assert.equal(last.ref, 'http://r/');
});

test('stream: playlist served as text/plain is still detected', async () => {
  const text = await (await api('stream', `${U}/plain-playlist`)).text();
  assert.ok(text.includes('/api/stream?url=' + encodeURIComponent(U + '/seg1.ts')));
});

test('stream: binary passes through untouched with range headers', async () => {
  const r = await api('stream', `${U}/live.ts`);
  const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(buf.length, 188 * 4);
  assert.equal(buf[188], 0x47);
  const f = await fetch(`${R}/api/fetch?url=${encodeURIComponent(U + '/file')}`, { headers: { range: 'bytes=0-3' } });
  assert.equal(f.status, 206);
  assert.equal(f.headers.get('content-range'), 'bytes 0-3/10');
  assert.equal(seen.find(s => s.url === '/file').range, 'bytes=0-3');
});

test('probe: tells HLS from MPEG-TS', async () => {
  assert.equal((await (await api('probe', `${U}/redir`)).json()).type, 'hls');
  assert.equal((await (await api('probe', `${U}/live.ts`)).json()).type, 'ts');
});

test('errors are readable', async () => {
  assert.equal((await fetch(`${R}/api/fetch?url=nope`)).status, 400);
  const r = await api('fetch', 'http://127.0.0.1:1/x');
  assert.equal(r.status, 502);
  assert.match(await r.text(), /neodpovedá/);
});

test('probe hands its connection to the stream (single-connection providers)', async () => {
  const pr = await (await api('probe', `${U}/one`)).json();
  assert.equal(pr.type, 'ts');
  const ac = new AbortController();
  const r = await fetch(`${R}/api/stream?url=${encodeURIComponent(U + '/one')}`, { signal: ac.signal });
  assert.equal(r.status, 200);
  const rd = r.body.getReader();
  let got = 0;
  while (got < 188 * 100) { const { value, done } = await rd.read(); if (done) break; got += value.length; }
  assert.ok(got >= 188 * 100);
  assert.equal(conns1, 1, 'only one upstream connection was opened');
  ac.abort();
  await new Promise(r => setTimeout(r, 200));
  assert.equal(open1, 0, 'upstream connection closed after the player left');
});
