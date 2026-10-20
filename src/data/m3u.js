// M3U / M3U8 (IPTV extended) playlist parser.
// Understands #EXTM3U header attributes (url-tvg, catchup*), #EXTINF attributes, #EXTGRP,
// #EXTVLCOPT http-user-agent / http-referrer and #KODIPROP stream headers.

const ATTR = /([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"|([A-Za-z0-9_-]+)\s*=\s*([^\s,"]+)/g;

function attrs(str) {
  const out = {};
  ATTR.lastIndex = 0;
  let m;
  while ((m = ATTR.exec(str))) out[(m[1] || m[3]).toLowerCase()] = (m[2] ?? m[4] ?? '').trim();
  return out;
}

/** Split "#EXTINF:-1 tvg-id="x" group-title="A, B",Name" into its attribute part and the display name. */
function splitExtinf(line) {
  const body = line.slice(line.indexOf(':') + 1);
  let inQ = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '"') inQ = !inQ;
    else if (c === ',' && !inQ) return [body.slice(0, i), body.slice(i + 1).trim()];
  }
  return [body, ''];
}

const XC_LIVE = /^(https?:\/\/[^/]+)\/(?:live\/)?([^/]+)\/([^/]+)\/(\d+)(\.\w+)?$/i;
const VOD = /\/(movie|series)\//i;

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

function catchupOf(a, header, url) {
  let type = (a['catchup'] || a['catchup-type'] || header.catchup || '').toLowerCase();
  const days = parseFloat(a['catchup-days'] || a['tvg-rec'] || a['timeshift'] || header.catchupDays || '') || 0;
  const source = a['catchup-source'] || header.catchupSource || '';
  if (!type && !days) return null;
  if (type === 'disabled' || type === 'none' || type === 'off') return null;
  if (!type) type = source ? 'default' : XC_LIVE.test(url) ? 'xc' : 'shift';
  if (type === 'default' && !source && XC_LIVE.test(url)) type = 'xc';
  return { type, days: days || 3, source };
}

/**
 * @param {string} text playlist contents
 * @returns {{ header: {tvgUrls: string[]}, channels: object[], vodCount: number }}
 */
export function parseM3U(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const header = { tvgUrls: [], catchup: '', catchupDays: '', catchupSource: '' };
  const channels = [];
  const seen = new Map();
  let pending = null, vodCount = 0;

  for (let raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTM3U')) {
      const a = attrs(line.slice(7));
      for (const k of ['url-tvg', 'x-tvg-url', 'tvg-url']) if (a[k]) header.tvgUrls.push(...a[k].split(',').map(s => s.trim()).filter(Boolean));
      header.catchup = a['catchup'] || a['catchup-type'] || '';
      header.catchupDays = a['catchup-days'] || '';
      header.catchupSource = a['catchup-source'] || '';
      continue;
    }
    if (line.startsWith('#EXTINF')) {
      const [a, name] = splitExtinf(line);
      pending = { a: attrs(a), name, group: '', ua: '', ref: '' };
      continue;
    }
    if (line.startsWith('#EXTGRP:')) { if (pending) pending.group = line.slice(8).trim(); continue; }
    if (line.startsWith('#EXTVLCOPT:')) {
      if (!pending) continue;
      const opt = line.slice(11);
      const [k, ...v] = opt.split('=');
      if (/http-user-agent/i.test(k)) pending.ua = v.join('=').trim();
      if (/http-referr?er/i.test(k)) pending.ref = v.join('=').trim();
      continue;
    }
    if (line.startsWith('#KODIPROP:')) {
      if (!pending) continue;
      const m = line.match(/stream_headers=(.*)$/i);
      if (m) for (const part of m[1].split('&')) {
        const [k, ...v] = part.split('=');
        const val = decodeURIComponent(v.join('=') || '');
        if (/^user-agent$/i.test(k)) pending.ua = val;
        if (/^referr?er$/i.test(k)) pending.ref = val;
      }
      continue;
    }
    if (line.startsWith('#')) continue;

    // A URL line closes the entry.
    const url = line;
    const p = pending || { a: {}, name: '', group: '', ua: '', ref: '' };
    pending = null;
    if (VOD.test(url)) { vodCount++; continue; }
    const a = p.a;
    const name = p.name || a['tvg-name'] || url.split('/').pop();
    const group = a['group-title'] || p.group || 'Ostatné';
    const key = (a['tvg-id'] || '') + '|' + name + '|' + group;
    const n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    channels.push({
      id: 'p' + hash(key + (n > 1 ? '#' + n : '')),
      name,
      group,
      url,
      tvgId: a['tvg-id'] || '',
      tvgName: a['tvg-name'] || '',
      logoUrl: a['tvg-logo'] || a['logo'] || '',
      chno: parseInt(a['tvg-chno'] || a['channel-number'] || a['tvg-number'] || '', 10) || 0,
      shift: parseFloat(a['tvg-shift'] || '') || 0,
      catchup: catchupOf(a, header, url),
      ua: p.ua || a['user-agent'] || '',
      ref: p.ref || a['referer'] || a['referrer'] || '',
    });
  }
  return { header, channels, vodCount };
}

/** Xtream Codes credentials → the provider's standard M3U and XMLTV links. */
export function xtreamUrls(server, user, pass) {
  const base = server.trim().replace(/\/+$/, '');
  const q = `username=${encodeURIComponent(user.trim())}&password=${encodeURIComponent(pass.trim())}`;
  return { m3u: `${base}/get.php?${q}&type=m3u_plus&output=ts`, epg: `${base}/xmltv.php?${q}` };
}
