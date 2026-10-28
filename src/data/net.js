// Where requests go. On the PC the local Node relay answers /api/* on the same address as the page;
// in the Android app the same relay runs inside the app on 127.0.0.1 (see android/…/Relay.java).
import { Capacitor, registerPlugin } from '@capacitor/core';

export const Native = Capacitor.isNativePlatform() ? registerPlugin('LocalRelay') : null;
export let nativeInfo = null;
let relay = false, ffmpeg = false, rec = false, base = '';
export const useRelay = () => relay;
/** Where the relay answers: this page's own server on the PC, 127.0.0.1:port inside the Android app. */
export const relayBase = () => (relay ? base || location.origin : '');
export const relayHasFfmpeg = () => ffmpeg;
export const canRecord = () => relay && ffmpeg && rec;

export async function detectRelay() {
  if (Native) {
    try { nativeInfo = await Native.info(); base = `http://127.0.0.1:${nativeInfo.port}`; relay = true; return relay; } catch (e) { console.warn(e); }
  }
  // For testing the Android relay from a desktop browser: ?relay=http://127.0.0.1:PORT
  const test = new URLSearchParams(location.search).get('relay');
  if (test && /^http:\/\/127\.0\.0\.1:\d+$/.test(test)) { base = test; relay = true; return relay; }
  try {
    const r = await fetch('/api/ping', { cache: 'no-store' });
    if (r.ok) { const j = await r.json(); relay = !!j.ok; ffmpeg = !!j.ffmpeg; rec = !!j.rec; }
  } catch { relay = false; }
  return relay;
}

const enc = encodeURIComponent;
// Absolute URLs: players such as mpegts.js download inside their own worker, where "/api/..." cannot be resolved.
const abs = p => (base && p.startsWith('/') ? base + p : new URL(p, location.href).href);
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
  const r = await fetch(abs(`/api/probe?url=${enc(url)}${extra(o)}`));
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

// Pairing: a phone sends the playlist to this device (see server/pair.js and Relay.java).
export async function pairStart() { const r = await fetch(abs('/api/pair-start'), { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }
export async function pairPoll(t) { const r = await fetch(abs(`/api/pair-poll?t=${enc(t)}`), { cache: 'no-store' }); return r.ok ? r.json() : { expired: true }; }

// Sending channels and categories to another device (same mechanism as pairing).
/** Puts the bundle on this device's relay for 15 minutes; another device reads it from one of { urls }. */
export async function shareStart(bundle) {
  const r = await fetch(abs('/api/share-start'), { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(bundle), cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
// The QR code carries the other device's best address and, in alt=, its other ones (a PC may have several
// network adapters). Each is tried for a few seconds, straight from the page (the other side answers with CORS).
const timeout = ms => (AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);
async function tryEach(urls, go) {
  let last = new Error('unreachable');
  for (const url of urls) {
    try { return await go(url); } catch (e) { if (e.message === 'expired') throw e; last = e; }
  }
  throw last;
}
/** Reads a bundle another device offers (its /share?t= addresses from the QR code). */
export const shareGet = urls => tryEach(urls, async url => {
  const r = await fetch(url, { cache: 'no-store', signal: timeout(5000) });
  if (r.status === 404) throw new Error('expired');
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
});
/** Sends a bundle to a device that waits for one (its /pair?t= addresses from the QR code). */
export const sharePush = (urls, bundle) => tryEach(urls, async url => {
  // text/plain keeps it a simple request (no preflight) to the other device on the home network
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ bundle }), cache: 'no-store', signal: timeout(8000) });
  if (r.status === 403) throw new Error('expired');
  if (!r.ok) throw new Error('HTTP ' + r.status);
});
export const canScan = () => !!Native && !(nativeInfo && nativeInfo.tv);
export async function scanQr() { return (await Native.scanQr()).value || ''; }
