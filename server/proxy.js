// Relay for the PC build. Browsers refuse most IPTV servers (no CORS headers, plain http, odd user agents),
// so the page asks this local server instead:
//   /api/fetch?url=   playlists and EPG, passed through untouched
//   /api/stream?url=  live streams; HLS playlists are rewritten so every segment also goes through here
//   /api/img?url=     channel logos (same origin, so the page can read their colours)
//   /api/probe?url=   tells whether a URL is HLS, MPEG-TS or something else
// Optional query params on every route: ua (User-Agent), ref (Referer).

import { Readable } from 'node:stream';
import { spawn, spawnSync } from 'node:child_process';

// ffmpeg is optional. With it, /api/remux re-packs a stream as MPEG-TS with AAC audio, so channels whose
// sound is AC-3 / E-AC-3 / MP2 (common in DVB-based IPTV) play in Chrome, which cannot decode those.
let ffmpegOk = null;
export function hasFfmpeg() {
  if (ffmpegOk === null) {
    try { ffmpegOk = spawnSync(process.env.FFMPEG || 'ffmpeg', ['-version'], { timeout: 4000 }).status === 0; } catch { ffmpegOk = false; }
  }
  return ffmpegOk;
}

function remux(req, res, target, q, log) {
  const args = ['-hide_banner', '-loglevel', 'error', '-fflags', '+genpts+discardcorrupt', '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '4',
    '-user_agent', q.get('ua') || DEFAULT_UA];
  if (q.get('ref')) args.push('-headers', `Referer: ${q.get('ref')}\r\n`);
  args.push('-i', target, '-map', '0:v:0?', '-map', '0:a?', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-f', 'mpegts', '-mpegts_flags', '+resend_headers', 'pipe:1');
  const ff = spawn(process.env.FFMPEG || 'ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  ff.stderr.on('data', d => { err = (err + d).slice(-500); });
  res.writeHead(200, { 'content-type': 'video/mp2t', 'cache-control': 'no-cache' });
  ff.stdout.pipe(res);
  ff.on('close', code => { if (code && !res.writableEnded) log(`✗ remux ${code} ${err.trim()}`); res.end(); });
  res.on('close', () => ff.kill('SIGKILL'));
}

export const DEFAULT_UA = 'VLC/3.0.20 LibVLC/3.0.20';
const PASS_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag'];

const isHttp = u => /^https?:\/\//i.test(u || '');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, X-Final-Url');
}

function upstreamHeaders(req, q) {
  const h = { 'user-agent': q.get('ua') || DEFAULT_UA, accept: '*/*' };
  if (q.get('ref')) h.referer = q.get('ref');
  if (req.headers.range) h.range = req.headers.range;
  return h;
}

export function looksLikeHlsPlaylist(contentType, url, firstBytes) {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('mpegurl')) return true;
  if (/\.m3u8(\?|$)/i.test(url)) return true;
  if (firstBytes && firstBytes.length) {
    const head = Buffer.from(firstBytes.subarray(0, 16)).toString('utf8').replace(/^﻿/, '').trimStart();
    return head.startsWith('#EXTM3U');
  }
  return false;
}

/** Point every URI in an HLS playlist back at this relay, resolved against the playlist's final URL. */
export function rewriteHls(text, baseUrl, extra = '') {
  const wrap = u => {
    let abs;
    try { abs = new URL(u, baseUrl).href; } catch { return u; }
    return `/api/stream?url=${encodeURIComponent(abs)}${extra}`;
  };
  return text.split(/\r?\n/).map(line => {
    const t = line.trim();
    if (!t) return line;
    if (t.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_, u) => `URI="${wrap(u)}"`);
    return wrap(t);
  }).join('\n');
}

function sniffType(contentType, url, bytes) {
  if (looksLikeHlsPlaylist(contentType, url, bytes)) return 'hls';
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('mp2t') || /\.ts(\?|$)/i.test(url) || (bytes && bytes[0] === 0x47 && (bytes.length < 189 || bytes[188] === 0x47))) return 'ts';
  if (ct.includes('mp4') || /\.(mp4|m4v|mov)(\?|$)/i.test(url)) return 'mp4';
  if (ct.includes('dash') || /\.mpd(\?|$)/i.test(url)) return 'dash';
  return 'unknown';
}

async function readFirst(body, min = 376) {
  const reader = body.getReader();
  const chunks = [];
  let size = 0;
  while (size < min) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value); size += value.length;
  }
  return { reader, first: Buffer.concat(chunks.map(c => Buffer.from(c))) };
}

// Many IPTV subscriptions allow a single connection and some stream links are one-time tokens, so the
// connection opened by /api/probe is kept for a few seconds and handed to the /api/stream request that follows.
const HANDOFF = new Map();
const handoffKey = (t, q) => `${t}|${q.get('ua') || ''}|${q.get('ref') || ''}`;
function dropHandoff(key, h) {
  if (HANDOFF.get(key) === h) HANDOFF.delete(key);
  clearTimeout(h.timer);
  h.reader.cancel().catch(() => {});
  h.ac.abort();
}

/** Node request handler. Returns false when the path is not ours. */
export async function handleApi(req, res, { log = () => {} } = {}) {
  const u = new URL(req.url, 'http://local');
  if (!u.pathname.startsWith('/api/')) return false;
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return true; }
  const route = u.pathname.slice(5);
  const q = u.searchParams;
  const target = q.get('url');
  if (route === 'ping') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, ffmpeg: hasFfmpeg() })); return true; }
  if (!isHttp(target)) { res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Chýba alebo je neplatná adresa (url).'); return true; }
  if (route === 'remux') {
    if (!hasFfmpeg()) { res.writeHead(501, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Na tomto PC nie je nainštalovaný ffmpeg.'); return true; }
    remux(req, res, target, q, log);
    return true;
  }

  const key = handoffKey(target, q);
  const pre = route === 'stream' && !req.headers.range ? HANDOFF.get(key) : null;
  if (pre) { HANDOFF.delete(key); clearTimeout(pre.timer); }
  const ac = pre ? pre.ac : new AbortController();
  // The probe's connection outlives the probe response (see HANDOFF); every other request ends with its client.
  if (route !== 'probe') res.on('close', () => ac.abort());
  let up = pre ? pre.up : null;
  try {
    if (!up) up = await fetch(target, { headers: upstreamHeaders(req, q), redirect: 'follow', signal: ac.signal });
  } catch (e) {
    if (ac.signal.aborted) return true;
    log(`✗ ${route} ${target} – ${e.cause?.code || e.message}`);
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`Server poskytovateľa neodpovedá (${e.cause?.code || e.message}).`);
    return true;
  }
  res.setHeader('X-Final-Url', up.url);
  if (!up.ok && up.status !== 206) log(`✗ ${route} ${up.status} ${target}`);

  const extra = (q.get('ua') ? `&ua=${encodeURIComponent(q.get('ua'))}` : '') + (q.get('ref') ? `&ref=${encodeURIComponent(q.get('ref'))}` : '');

  try {
    if (route === 'probe') {
      const { reader, first } = up.body ? await readFirst(up.body) : { reader: null, first: Buffer.alloc(0) };
      const type = sniffType(up.headers.get('content-type'), up.url, first);
      if (reader && up.ok) {
        const old = HANDOFF.get(key);
        if (old) dropHandoff(key, old);
        const h = { up, reader, first, ac };
        h.timer = setTimeout(() => dropHandoff(key, h), 10000);
        HANDOFF.set(key, h);
      } else { reader?.cancel().catch(() => {}); ac.abort(); }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: up.status, type, url: up.url, contentType: up.headers.get('content-type') }));
      return true;
    }

    if (route === 'stream' && up.ok) {
      const ct = up.headers.get('content-type');
      const { reader, first } = pre || await readFirst(up.body, 16);
      // HLS playlists are small: read, rewrite, send. Everything else is piped as it arrives.
      if (looksLikeHlsPlaylist(ct, up.url, first)) {
        let text = first.toString('utf8');
        for (;;) { const { value, done } = await reader.read(); if (done) break; text += Buffer.from(value).toString('utf8'); }
        res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl', 'cache-control': 'no-cache' });
        res.end(rewriteHls(text, up.url, extra));
        return true;
      }
      const head = {};
      for (const h of PASS_HEADERS) { const v = up.headers.get(h); if (v) head[h] = v; }
      res.writeHead(up.status, head);
      res.write(first);
      Readable.fromWeb(new ReadableStream({ pull: async c => { const { value, done } = await reader.read(); if (done) c.close(); else c.enqueue(value); }, cancel: () => reader.cancel() })).on('error', () => res.destroy()).pipe(res);
      return true;
    }

    const head = { 'cache-control': route === 'img' ? 'public, max-age=604800' : 'no-cache' };
    for (const h of PASS_HEADERS) { const v = up.headers.get(h); if (v) head[h] = v; }
    // fetch() already undid any Content-Encoding, so the length no longer matches.
    if (up.headers.get('content-encoding')) delete head['content-length'];
    res.writeHead(up.status, head);
    if (!up.body) { res.end(); return true; }
    Readable.fromWeb(up.body).on('error', () => res.destroy()).pipe(res);
  } catch (e) {
    if (!ac.signal.aborted) {
      log(`✗ ${route} ${target} – ${e.message}`);
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end();
    }
  }
  return true;
}

/** Connect/Vite style middleware. */
export const proxyMiddleware = (opts) => (req, res, next) => {
  handleApi(req, res, opts).then(handled => { if (!handled) next(); }, err => next(err));
};
