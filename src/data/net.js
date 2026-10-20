// Where requests go. With the local relay (PC build) everything is routed through /api/*;
// on the TV the packaged app talks to the provider directly.

let relay = false, ffmpeg = false;
export const useRelay = () => relay;
export const relayHasFfmpeg = () => ffmpeg;

export async function detectRelay() {
  try {
    const r = await fetch('/api/ping', { cache: 'no-store' });
    if (r.ok) { const j = await r.json(); relay = !!j.ok; ffmpeg = !!j.ffmpeg; }
  } catch { relay = false; }
  return relay;
}

const enc = encodeURIComponent;
const extra = o => (o && o.ua ? `&ua=${enc(o.ua)}` : '') + (o && o.ref ? `&ref=${enc(o.ref)}` : '');
export const fetchUrl = (url, o) => (relay ? `/api/fetch?url=${enc(url)}${extra(o)}` : url);
export const streamUrl = (url, o) => (relay ? `/api/stream?url=${enc(url)}${extra(o)}` : url);
export const remuxUrl = (url, o) => `/api/remux?url=${enc(url)}${extra(o)}`;
export const imgUrl = url => (relay && /^https?:/i.test(url) ? `/api/img?url=${enc(url)}` : url);

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
