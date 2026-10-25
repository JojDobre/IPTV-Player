// Background work: downloading and parsing the playlist and the EPG, so the UI never stutters.
import { parseM3U } from './m3u.js';
import { XmltvParser, nameKey } from './xmltv.js';
import { idbSet } from './db.js';

const enc = encodeURIComponent;
const via = (url, o) => (o.relay ? new URL(`/api/fetch?url=${enc(url)}${o.ua ? `&ua=${enc(o.ua)}` : ''}`, self.location.href).href : url);

async function open(url, o) {
  let r;
  try { r = await fetch(via(url, o)); } catch (e) { throw new Error('Nepodarilo sa spojiť so serverom poskytovateľa.'); }
  if (!r.ok) {
    let msg = '';
    try { msg = (await r.text()).slice(0, 200); } catch {}
    throw new Error(r.status === 401 || r.status === 403 ? 'Server odmietol prístup (skontroluj meno, heslo alebo platnosť predplatného).'
      : r.status === 404 ? 'Adresa neexistuje (404).' : msg || `Server vrátil chybu ${r.status}.`);
  }
  return r;
}

/** Bytes of a response as a stream of text, un-gzipping when the file is .gz (detected by magic bytes). */
async function textStream(r, onBytes) {
  const reader = r.body.getReader();
  let first = await reader.read();
  const head = first.value || new Uint8Array(0);
  let seen = head.length;
  onBytes(seen);
  const raw = new ReadableStream({
    start(c) { if (head.length) c.enqueue(head); if (first.done) c.close(); },
    async pull(c) { const { value, done } = await reader.read(); if (done) return c.close(); seen += value.length; onBytes(seen); c.enqueue(value); },
    cancel() { reader.cancel(); },
  });
  const gz = head[0] === 0x1f && head[1] === 0x8b;
  return (gz ? raw.pipeThrough(new DecompressionStream('gzip')) : raw).pipeThrough(new TextDecoderStream());
}

async function m3u(msg, post) {
  const r = await open(msg.url, msg);
  const total = +r.headers.get('content-length') || 0;
  const s = await textStream(r, b => post({ progress: { bytes: b, total } }));
  let text = '';
  const rd = s.getReader();
  for (;;) { const { value, done } = await rd.read(); if (done) break; text += value; }
  if (!/#EXTM3U|#EXTINF/i.test(text.slice(0, 4096))) throw new Error('Toto nie je M3U playlist. Skontroluj adresu.');
  return parseM3U(text);
}

async function epg(msg, post) {
  const now = Date.now();
  const from = now - (msg.pastDays || 8) * 86400000, to = now + 4 * 86400000;
  const byTvg = new Map(), byName = new Map();
  for (const c of msg.channels) {
    if (c.tvgId) { const k = c.tvgId.toLowerCase(); (byTvg.get(k) || byTvg.set(k, []).get(k)).push(c.id); }
    for (const n of [c.tvgName, c.name]) if (n) { const k = nameKey(n); if (k) (byName.get(k) || byName.set(k, []).get(k)).push(c.id); }
  }
  const epgToIds = new Map();
  const resolve = (epgId, names = []) => {
    let ids = byTvg.get(epgId.toLowerCase());
    if (!ids) for (const n of [...names, epgId]) { ids = byName.get(nameKey(n)); if (ids) break; }
    return ids || null;
  };
  const programmes = {}, map = {};
  let count = 0, bytes = 0, lastPost = 0;
  const parser = new XmltvParser({
    onChannel(c) { if (!epgToIds.has(c.id)) epgToIds.set(c.id, resolve(c.id, c.names)); },
    onProgramme(p) {
      if (!(p.stop > from && p.start < to)) return;
      if (!epgToIds.has(p.channel)) epgToIds.set(p.channel, resolve(p.channel));
      const ids = epgToIds.get(p.channel);
      if (!ids) return;
      const key = p.channel;
      (programmes[key] ||= []).push([p.start, p.stop, p.title, p.desc.length > 500 ? p.desc.slice(0, 497) + '…' : p.desc, p.category]);
      for (const id of ids) if (!map[id]) map[id] = key;
      count++;
    },
  });
  for (const url of msg.urls) {
    let r;
    try { r = await open(url, msg); } catch (e) { if (msg.urls.length === 1) throw e; post({ warn: `${url}: ${e.message}` }); continue; }
    const total = +r.headers.get('content-length') || 0;
    const base = bytes;
    const s = await textStream(r, b => { bytes = base + b; if (bytes - lastPost > 2e6) { lastPost = bytes; post({ progress: { bytes, total: total ? base + total : 0, programmes: count } }); } });
    const rd = s.getReader();
    for (;;) { const { value, done } = await rd.read(); if (done) break; parser.push(value); }
  }
  for (const k in programmes) {
    const l = programmes[k].sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const p of l) { const last = out[out.length - 1]; if (last && p[0] < last[1]) { if (p[0] === last[0]) continue; last[1] = p[0]; } out.push(p); }
    programmes[k] = out;
  }
  // Everything goes into one binary block (JSON per channel + an index of byte ranges). Storing and handing a
  // single ArrayBuffer to the page is a plain memory copy; the page parses a channel only when it shows it.
  const te = new TextEncoder(), parts = [], index = {};
  let size = 0;
  for (const k in programmes) { const b = te.encode(JSON.stringify(programmes[k])); index[k] = [size, b.length]; parts.push(b); size += b.length; }
  const blob = new Uint8Array(size);
  let o = 0;
  for (const b of parts) { blob.set(b, o); o += b.length; }
  const epg = { v: 2, map, index, buf: blob.buffer };
  await idbSet('epg', epg);
  return { epg, count, matched: Object.keys(map).length, transfer: [blob.buffer] };
}

self.onmessage = async e => {
  const { id, type } = e.data;
  const post = (m, transfer) => self.postMessage({ id, ...m }, transfer || []);
  try {
    const result = type === 'm3u' ? await m3u(e.data, post) : await epg(e.data, post);
    const transfer = result.transfer; delete result.transfer;
    post({ done: true, result }, transfer);
  } catch (err) {
    post({ error: err.message || String(err) });
  }
};
