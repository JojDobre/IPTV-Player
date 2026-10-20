// Streaming XMLTV parser. Feed it text chunks; it calls back for every <channel> and <programme>
// without ever holding the whole file (EPG files are often 50–300 MB).

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeXml(s) {
  if (!s) return '';
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return ENT[e.toLowerCase()] ?? m;
  }).trim();
}

const ATTR = /([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
function attrs(tag) {
  const out = {};
  ATTR.lastIndex = 0;
  let m;
  while ((m = ATTR.exec(tag))) out[m[1]] = decodeXml(m[3] ?? m[4] ?? '');
  return out;
}

/** "20241020183000 +0200" → epoch ms. Missing zone means UTC. */
export function parseXmltvTime(s) {
  const m = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?\s*([+-])?(\d\d)?:?(\d\d)?/.exec(s || '');
  if (!m) return NaN;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  const off = m[7] ? (m[7] === '-' ? -1 : 1) * ((+m[8] || 0) * 60 + (+m[9] || 0)) * 60000 : 0;
  return t - off;
}

function first(block, tag) {
  const re = new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
  const m = re.exec(block);
  return m ? decodeXml(m[2]) : '';
}
function all(block, tag) {
  const re = new RegExp(`<${tag}(\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(block))) out.push(decodeXml(m[2]));
  return out;
}

export class XmltvParser {
  /** @param {{onChannel?: Function, onProgramme?: Function}} cb */
  constructor(cb) { this.cb = cb; this.buf = ''; }

  push(text) {
    this.buf += text;
    let pos = 0, partial = false;
    const b = this.buf;
    for (;;) {
      const p = b.indexOf('<programme', pos);
      const c = b.indexOf('<channel', pos);
      let at, kind;
      if (p < 0 && c < 0) break;
      partial = true;
      if (c >= 0 && (p < 0 || c < p)) { at = c; kind = 'channel'; } else { at = p; kind = 'programme'; }
      const close = `</${kind}>`;
      const tagEnd = b.indexOf('>', at);
      if (tagEnd < 0) { pos = at; break; }
      // Self-closing element (<programme ... />) has no body.
      let end;
      if (b[tagEnd - 1] === '/') end = tagEnd + 1;
      else {
        const ci = b.indexOf(close, tagEnd);
        if (ci < 0) { pos = at; break; }
        end = ci + close.length;
      }
      const block = b.slice(at, end);
      const head = b.slice(at, tagEnd + 1);
      if (kind === 'programme') this.programme(head, block);
      else this.channel(head, block);
      pos = end;
      partial = false;
    }
    // Keep an unfinished element, or just a short tail that might be the start of the next tag.
    this.buf = partial ? b.slice(pos) : b.slice(Math.max(pos, b.length - 16));
  }

  channel(head, block) {
    if (!this.cb.onChannel) return;
    const a = attrs(head);
    const icon = /<icon[^>]*\ssrc\s*=\s*"([^"]*)"/i.exec(block);
    this.cb.onChannel({ id: a.id || '', names: all(block, 'display-name'), icon: icon ? decodeXml(icon[1]) : '' });
  }

  programme(head, block) {
    if (!this.cb.onProgramme) return;
    const a = attrs(head);
    this.cb.onProgramme({
      channel: a.channel || '',
      start: parseXmltvTime(a.start),
      stop: parseXmltvTime(a.stop),
      title: first(block, 'title'),
      desc: first(block, 'desc'),
      category: first(block, 'category'),
    });
  }
}

/** Loose key for matching playlist names against EPG display names ("Šport 1 HD" ≈ "sport1"). */
export function nameKey(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\b(f?hd|uhd|4k|sd|hevc|h265|raw|backup|\(.*?\)|\[.*?\])\b/g, '')
    .replace(/[^a-z0-9+]/g, '');
}
