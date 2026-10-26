// Adding a playlist from a phone: the TV (or any screen) asks for a one-time code, shows a QR code with
// http://<this PC>:<port>/pair?t=<code>, the phone sends the form there, and the TV picks it up.
//   GET  /api/pair-start          → { token, urls }   (code valid 15 minutes)
//   GET  /api/pair-poll?t=        → { data } once the phone has sent it, otherwise { wait: true }
//   GET  /pair?t=                 → the form (dist/pair.html)
//   POST /pair?t=                 → JSON from the form
import { readFileSync, existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { randomBytes } from 'node:crypto';

const codes = new Map();   // token -> { exp, data }
const TTL = 15 * 60e3;
const alive = t => { const c = codes.get(t); if (c && c.exp > Date.now()) return c; codes.delete(t); return null; };
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
export const lanAddresses = () => Object.values(networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);

export function pairApi(route, req, res, q) {
  if (route === 'pair-start') {
    for (const [t, c] of codes) if (c.exp < Date.now()) codes.delete(t);
    const token = randomBytes(12).toString('base64url');
    codes.set(token, { exp: Date.now() + TTL, data: null });
    const port = req.socket.localPort;
    json(res, 200, { token, urls: lanAddresses().map(ip => `http://${ip}:${port}/pair?t=${token}`) });
    return;
  }
  if (route === 'pair-poll') {
    const c = alive(q.get('t'));
    if (!c) return json(res, 404, { error: 'expired' });
    if (!c.data) return json(res, 200, { wait: true });
    codes.delete(q.get('t'));
    json(res, 200, { data: c.data });
  }
}

/** The page and the form post; returns false for anything that is not /pair. */
export function pairPage(req, res, distDir) {
  const u = new URL(req.url, 'http://x');
  if (u.pathname !== '/pair') return false;
  const c = alive(u.searchParams.get('t'));
  if (!c) { res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Kód neplatí. Na TV otvor QR kód znova. / This code has expired.'); return true; }
  if (req.method === 'POST') {
    let b = '';
    req.on('data', d => { b += d; if (b.length > 2e4) req.destroy(); });
    req.on('end', () => {
      try {
        const d = JSON.parse(b), s = v => String(v || '').slice(0, 2000);
        c.data = { name: s(d.name), m3u: s(d.m3u), epg: s(d.epg), server: s(d.server), user: s(d.user), pass: s(d.pass) };
        json(res, 200, { ok: true });
      } catch { json(res, 400, { error: 'bad request' }); }
    });
    return true;
  }
  const file = distDir + 'pair.html';
  if (!existsSync(file)) { res.writeHead(404); res.end(); return true; }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(readFileSync(file));
  return true;
}
