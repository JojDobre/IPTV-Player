// Adding a playlist from a phone: the TV (or any screen) asks for a one-time code, shows a QR code with
// http://<this PC>:<port>/pair?t=<code>, the phone sends the form there, and the TV picks it up.
//   GET  /api/pair-start          → { token, urls }   (code valid 15 minutes)
//   GET  /api/pair-poll?t=        → { data } once the phone has sent it, otherwise { wait: true }
//   GET  /pair?t=                 → the form (dist/pair.html)
//   POST /pair?t=                 → JSON from the form, or { bundle } from another OnAir (channels and categories)
// Sending channels and categories to another device (it scans the QR code in the app):
//   POST /api/share-start         → { token, urls }   the body is the bundle, kept 15 minutes
//   GET  /share?t=                → the bundle (readable from the home network)
import { readFileSync, existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { randomBytes } from 'node:crypto';

const codes = new Map();   // token -> { exp, data }
const shares = new Map();  // token -> { exp, body }
const MAX = 4e6;
const TTL = 15 * 60e3;
const alive = t => { const c = codes.get(t); if (c && c.exp > Date.now()) return c; codes.delete(t); return null; };
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(body)); };
// The address of the home network first: a Windows PC also has WSL, Hyper-V, VirtualBox or VPN adapters, and a
// phone cannot reach those. They stay at the end, the phone tries them too.
const VIRTUAL = /vethernet|wsl|hyper-v|virtualbox|vmware|vmnet|docker|^br-|^veth|tun|tap|utun|zerotier|tailscale|hamachi|vpn|loopback|bluetooth/i;
const rank = (name, ip) => (VIRTUAL.test(name) ? 100 : 0) + (/wi-?fi|wlan|wireless|^en\d|^eth|ethernet|lan/i.test(name) ? 0 : 10)
  + (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 3 : 2);
export const lanAddresses = () => Object.entries(networkInterfaces())
  .flatMap(([name, list]) => (list || []).filter(i => i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.')).map(i => ({ ip: i.address, r: rank(name, i.address) })))
  .sort((a, b) => a.r - b.r).map(x => x.ip);

export function pairApi(route, req, res, q) {
  if (route === 'pair-start') {
    for (const [t, c] of codes) if (c.exp < Date.now()) codes.delete(t);
    const token = randomBytes(12).toString('base64url');
    codes.set(token, { exp: Date.now() + TTL, data: null });
    const port = req.socket.localPort;
    json(res, 200, { token, urls: lanAddresses().map(ip => `http://${ip}:${port}/pair?t=${token}`) });
    return;
  }
  if (route === 'share-start') {
    let b = '';
    req.on('data', d => { b += d; if (b.length > MAX) req.destroy(); });
    req.on('end', () => {
      for (const [t, c] of shares) if (c.exp < Date.now()) shares.delete(t);
      try { JSON.parse(b); } catch { return json(res, 400, { error: 'bad request' }); }
      const token = randomBytes(12).toString('base64url');
      shares.set(token, { exp: Date.now() + TTL, body: b });
      const port = req.socket.localPort;
      json(res, 200, { token, urls: lanAddresses().map(ip => `http://${ip}:${port}/share?t=${token}`) });
    });
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
  if (u.pathname === '/share') {
    const s = shares.get(u.searchParams.get('t'));
    if (!s || s.exp < Date.now()) { json(res, 404, { error: 'expired' }); return true; }
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
    res.end(s.body);
    return true;
  }
  if (u.pathname !== '/pair') return false;
  const c = alive(u.searchParams.get('t'));
  if (!c) { res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Kód neplatí. Na TV otvor QR kód znova. / This code has expired.'); return true; }
  if (req.method === 'POST') {
    let b = '';
    req.on('data', d => { b += d; if (b.length > MAX) req.destroy(); });
    req.on('end', () => {
      try {
        const d = JSON.parse(b), s = v => String(v || '').slice(0, 2000);
        c.data = { name: s(d.name), m3u: s(d.m3u), epg: s(d.epg), server: s(d.server), user: s(d.user), pass: s(d.pass) };
        if (d.bundle && typeof d.bundle === 'object') c.data.bundle = d.bundle;
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
