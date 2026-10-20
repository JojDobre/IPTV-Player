// Builds archive (catch-up) URLs the way IPTV providers expect them.
// Supported channel types: default, append, shift/timeshift, flussonic (fs), xc/xtream.
// Placeholders follow the Kodi IPTV Simple / TiviMate conventions.

const pad = (n, w = 2) => String(n).padStart(w, '0');

function fmt(sec, pattern, utc = true) {
  const d = new Date(sec * 1000);
  const g = utc
    ? { Y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), H: d.getUTCHours(), M: d.getUTCMinutes(), S: d.getUTCSeconds() }
    : { Y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), H: d.getHours(), M: d.getMinutes(), S: d.getSeconds() };
  return pattern.replace(/[YmdHMS]/g, c => (c === 'Y' ? String(g.Y) : pad(g[c])));
}

/** Replace every supported placeholder in a catch-up template. Times are in seconds. */
export function fillTemplate(tpl, { start, end, now }) {
  const duration = Math.max(60, end - start);
  return tpl
    .replace(/\{(utc|start|utcend|end|lutc|now|timestamp):([^}]+)\}|\$\{(start|end|timestamp|now):([^}]+)\}/g, (_, a, f1, b, f2) => {
      const k = a || b, f = f1 || f2;
      const t = k === 'utcend' || k === 'end' ? end : k === 'lutc' || k === 'now' || k === 'timestamp' ? now : start;
      return fmt(t, f);
    })
    .replace(/\{duration:(\d+)\}|\$\{duration:(\d+)\}/g, (_, a, b) => String(Math.round(duration / (+(a || b) || 1))))
    .replace(/\{offset:(\d+)\}|\$\{offset:(\d+)\}/g, (_, a, b) => String(Math.round((now - start) / (+(a || b) || 1))))
    .replace(/\$\{start\}|\{utc\}|\{start\}/g, String(start))
    .replace(/\$\{end\}|\{utcend\}|\{end\}/g, String(end))
    .replace(/\$\{timestamp\}|\{lutc\}|\$\{now\}|\{now\}/g, String(now))
    .replace(/\$\{duration\}|\{duration\}/g, String(duration))
    .replace(/\$\{offset\}|\{offset\}/g, String(now - start))
    .replace(/\{Y\}/g, fmt(start, 'Y')).replace(/\{m\}/g, fmt(start, 'm')).replace(/\{d\}/g, fmt(start, 'd'))
    .replace(/\{H\}/g, fmt(start, 'H')).replace(/\{M\}/g, fmt(start, 'M')).replace(/\{S\}/g, fmt(start, 'S'));
}

const XC = /^(https?:\/\/[^/]+)\/(?:live\/)?([^/]+)\/([^/]+)\/(\d+)(\.\w+)?$/i;

/** True when the channel offers archive for that moment. */
export function hasArchive(ch, startMs, nowMs = Date.now()) {
  return !!(ch && ch.catchup && startMs >= nowMs - ch.catchup.days * 86400000 && startMs < nowMs);
}

/**
 * @param {object} ch channel with url and catchup {type, days, source}
 * @param {number} startMs archive start
 * @param {number} endMs programme end (or start + 4 h for open-ended playback)
 * @returns {string|null}
 */
export function catchupUrl(ch, startMs, endMs, nowMs = Date.now()) {
  const c = ch.catchup;
  if (!c) return null;
  const t = { start: Math.floor(startMs / 1000), end: Math.floor(Math.min(endMs, nowMs) / 1000), now: Math.floor(nowMs / 1000) };
  if (t.end <= t.start) t.end = t.start + 60;
  const url = ch.url;
  const type = c.type;

  if (type === 'default') return c.source ? fillTemplate(c.source, t) : null;
  if (type === 'append') return url + fillTemplate(c.source || '?utc={utc}&lutc={lutc}', t);
  if (type === 'shift' || type === 'timeshift') return url + (url.includes('?') ? '&' : '?') + `utc=${t.start}&lutc=${t.now}`;
  if (type === 'flussonic' || type === 'flussonic-hls' || type === 'flussonic-ts' || type === 'fs') {
    const dur = t.end - t.start;
    if (/\/mpegts(\?|$)/.test(url)) return url.replace(/\/mpegts(\?|$)/, `/timeshift_abs-${t.start}.ts$1`);
    if (/\.m3u8(\?|$)/.test(url)) return url.replace(/\/([^/]+?)\.m3u8(\?|$)/, (_, name, q) => `/${name === 'index' || name === 'video' ? 'index' : name}-${t.start}-${dur}.m3u8${q}`);
    return url.replace(/\/?(\?|$)/, `/timeshift_abs-${t.start}.ts$1`);
  }
  if (type === 'xc' || type === 'xtream') {
    const m = url.match(XC);
    if (!m) return null;
    const [, host, user, pass, id] = m;
    const minutes = Math.max(1, Math.ceil((t.end - t.start) / 60));
    // Xtream servers expect the start in their own local time; the box's local time is the usual match.
    return `${host}/timeshift/${user}/${pass}/${minutes}/${fmt(t.start, 'Y-m-d:H-M', false)}/${id}.ts`;
  }
  return c.source ? fillTemplate(c.source, t) : null;
}
