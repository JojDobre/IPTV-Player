// Main-thread side of the library: talks to the worker and keeps the playlist + EPG in IndexedDB.
import { idbGet, idbSet, idbDel } from './db.js';
import { useRelay } from './net.js';

let worker, seq = 0;
const jobs = new Map();
function call(type, payload, onProgress) {
  worker ||= new Worker(new URL('./library.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = e => {
    const j = jobs.get(e.data.id); if (!j) return;
    if (e.data.progress) j.onProgress?.(e.data.progress);
    else if (e.data.warn) console.warn(e.data.warn);
    else { jobs.delete(e.data.id); e.data.error ? j.reject(new Error(e.data.error)) : j.resolve(e.data.result); }
  };
  return new Promise((resolve, reject) => {
    const id = ++seq;
    jobs.set(id, { resolve, reject, onProgress });
    worker.postMessage({ id, type, relay: useRelay(), ...payload });
  });
}

export const loadPlaylist = (src, onProgress) => call('m3u', { url: src.m3u, ua: src.ua || '' }, onProgress);
export const loadEpg = (urls, channels, opts, onProgress) => call('epg', {
  urls, ua: opts.ua || '', pastDays: opts.pastDays || 8,
  channels: channels.map(c => ({ id: c.id, tvgId: c.tvgId, tvgName: c.tvgName, name: c.name })),
}, onProgress);

export const getLibrary = () => idbGet('library');
export const setLibrary = lib => idbSet('library', lib);
export const getEpg = () => idbGet('epg');
export const setEpg = epg => idbSet('epg', epg);
export async function clearLibrary() { await idbDel('library'); await idbDel('epg'); }
