// Where requests go. With the local relay (PC build) everything is routed through /api/*;
// on the TV the packaged app talks to the provider directly.

let relay = false, ffmpeg = false, rec = false;
export const useRelay = () => relay;
export const relayHasFfmpeg = () => ffmpeg;
export const canRecord = () => relay && ffmpeg && rec;

export async function detectRelay() {
  try {
    const r = await fetch('/api/ping', { cache: 'no-store' });
    if (r.ok) { const j = await r.json(); relay = !!j.ok; ffmpeg = !!j.ffmpeg; rec = !!j.rec; }
  } catch { relay = false; }
  return relay;
}

const enc = encodeURIComponent;
// Absolute URLs: players such as mpegts.js download inside their own worker, where "/api/..." cannot be resolved.
const abs = p => new URL(p, location.href).href;
const extra = o => (o && o.ua ? `&ua=${enc(o.ua)}` : '') + (o && o.ref ? `&ref=${enc(o.ref)}` : '');
export const fetchUrl = (url, o) => (relay ? abs(`/api/fetch?url=${enc(url)}${extra(o)}`) : url);
export const streamUrl = (url, o) => (relay ? abs(`/api/stream?url=${enc(url)}${extra(o)}`) : url);
export const remuxUrl = (url, o, video) => abs(`/api/remux?url=${enc(url)}${extra(o)}${video ? '&v=1' : ''}`);
export async function streamInfo(url, o) {
  if (!relay || !ffmpeg) return [];
  try { const r = await fetch(abs(`/api/info?url=${enc(url)}${extra(o)}`)); return r.ok ? (await r.json()).streams || [] : []; } catch { return []; }
}
export const imgUrl = url => (relay && /^https?:/i.test(url) ? abs(`/api/img?url=${enc(url)}`) : url);

export async function probe(url, o) {
  if (!relay) return { type: 'unknown' };
  const r = await fetch(`/api/probe?url=${enc(url)}${extra(o)}`);
  return r.ok ? r.json() : { type: 'unknown' };
}

export function guessKind(url) {
  const path = (url || '').split('?')[0].toLowerCase();
  if (path.endsWith('.m3u8') || path.endsWith('.m3u')) return 'hls';
  if (path.endsWith('.ts') || path.endsWith('/mpegts')) return 'ts';
  if (/\.(mp4|m4v|mkv|webm|mov)$/.test(path)) return 'file';
  return '';
}

// Recordings (local server only).
export const recFileUrl = id => abs(`/api/rec/file?id=${enc(id)}`);
async function recCall(path, method = 'GET', body) {
  const r = await fetch(abs('/api/' + path), { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
export const recList = () => recCall('rec');
export const recAdd = item => recCall('rec', 'POST', item);
export const recStop = id => recCall(`rec/stop?id=${enc(id)}`, 'POST');
export const recDelete = id => recCall(`rec?id=${enc(id)}`, 'DELETE');
