// Vysielač – IPTV player UI. Screens, spatial navigation for TV remotes, and the player.
import '@fontsource/onest/400.css';
import '@fontsource/onest/500.css';
import '@fontsource/onest/600.css';
import '@fontsource/onest/700.css';
import '@fontsource/unbounded/700.css';
import '@fontsource/unbounded/800.css';
import '@fontsource/bebas-neue/400.css';
import '@fontsource/fraunces/600-italic.css';
import './styles.css';
import { buildDemo } from './data/demo.js';
import { detectRelay, imgUrl, useRelay, relayHasFfmpeg, streamInfo, canRecord, recList, recAdd, recStop, recDelete, recFileUrl } from './data/net.js';
import { xtreamUrls } from './data/m3u.js';
import { nameKey } from './data/xmltv.js';
import { catchupUrl, hasArchive as hasArchiveReal } from './data/catchup.js';
import * as library from './data/library.js';
import { Engine, langMatches } from './player/engine.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const store = {
  get(k, d) { try { const v = localStorage.getItem('vysielac2:' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('vysielac2:' + k, JSON.stringify(v)); } catch (e) {} },
};
const I = (id, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const isWide = () => matchMedia('(min-width: 761px)').matches;

/* ---------- Library: the playlist's channels and EPG, or the built-in demo ---------- */
let CH = [], byId = {}, EPG = {}, catName = {}, GROUPS = [], DEFAULTS = { fav: [], recent: [], quick: [] };
let LIB = null;          // saved playlist: { source, header, channels, updated, epgUpdated, epgMatched, vodCount }
let EPG_RAW = null;      // { map: {channelId: epgId}, index: {epgId: [offset, length]}, buf: ArrayBuffer of JSON [[start, stop, title, desc, category]] }
const epgCache = new Map();
const utf8 = new TextDecoder();
const idOf = name => (CH.find(c => c.name === name) || CH[0] || {}).id;
const MIN = 60000;
const day0 = new Date(); day0.setHours(0, 0, 0, 0);
const D0 = day0.getTime();
const hasArchive = (ch, t) => !!ch && (ch.catchup?.type === 'demo' ? t >= Date.now() - 2 * 86400e3 : hasArchiveReal(ch, t));

function epgFor(id) {
  if (EPG[id]) return EPG[id];
  if (!EPG_RAW) return null;
  if (epgCache.has(id)) return epgCache.get(id);
  const key = EPG_RAW.map[id];
  let raw = null;
  if (key && EPG_RAW.buf) {
    const ix = EPG_RAW.index[key];
    if (ix) try { raw = JSON.parse(utf8.decode(new Uint8Array(EPG_RAW.buf, ix[0], ix[1]))); } catch { raw = null; }
  } else if (key && EPG_RAW.programmes) raw = EPG_RAW.programmes[key];
  const shift = (byId[id]?.shift || 0) * 3600e3;
  const list = raw ? raw.map(r => ({ start: r[0] + shift, end: r[1] + shift, title: r[2] || 'Bez názvu', desc: r[3] || '', genre: r[4] || '' })) : null;
  if (epgCache.size > 2500) epgCache.delete(epgCache.keys().next().value);
  epgCache.set(id, list);
  return list;
}
const noProg = (id, start, end) => ({ start, end, title: byId[id]?.name || '', genre: '', desc: '', none: true });
/** The programme on air on channel `id` at time `t` (a placeholder hour slot when the EPG has nothing). */
function progAt(id, t) {
  const l = epgFor(id);
  if (l && l.length) {
    let lo = 0, hi = l.length - 1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (l[m].end <= t) lo = m + 1; else if (l[m].start > t) hi = m - 1; else return l[m]; }
  }
  const s = Math.floor(t / 3600e3) * 3600e3;
  return noProg(id, s, s + 3600e3);
}
function progNext(id, p) {
  const l = epgFor(id);
  if (!p.none && l) { const i = l.indexOf(p); if (i >= 0) return l[i + 1] || null; }
  const n = progAt(id, p.end);
  return n.none ? null : n;
}
/** Programmes overlapping [from, to); one "no guide" block when the EPG is empty. */
function progsIn(id, from, to) {
  const l = epgFor(id);
  const out = l ? l.filter(p => p.end > from && p.start < to) : [];
  return out.length ? out : [noProg(id, from, to)];
}
const findProg = (id, start) => { const l = epgFor(id); return (l && l.find(x => x.start === start)) || progAt(id, start); };

/* ---------- Formatting ---------- */
const pad2 = n => String(n).padStart(2, '0');
const hm = t => { const d = new Date(t); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };
const hms = t => { const d = new Date(t); return hm(t) + ':' + pad2(d.getSeconds()); };
const frac = (p, t) => Math.min(1, Math.max(0, (t - p.start) / (p.end - p.start)));
const durTxt = s => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return h ? `${h}:${pad2(m)}:${pad2(x)}` : `${m}:${pad2(x)}`; };
const remain = (p, now) => now < p.start ? `o ${Math.round((p.start - now) / MIN)} min` : `zostáva ${Math.max(1, Math.round((p.end - now) / MIN))} min`;
const DAYS = ['nedeľa', 'pondelok', 'utorok', 'streda', 'štvrtok', 'piatok', 'sobota'];
const MONTHS = ['januára', 'februára', 'marca', 'apríla', 'mája', 'júna', 'júla', 'augusta', 'septembra', 'októbra', 'novembra', 'decembra'];
const dateTxt = t => { const d = new Date(t); return `${DAYS[d.getDay()]} ${d.getDate()}. ${MONTHS[d.getMonth()]}`; };
const greeting = t => { const h = new Date(t).getHours(); return h < 5 ? 'Dobrú noc' : h < 10 ? 'Dobré ráno' : h < 18 ? 'Dobrý deň' : h < 22 ? 'Dobrý večer' : 'Dobrú noc'; };
const sod = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const dayIdx = t => Math.round((sod(t) - sod(Date.now())) / 864e5);
const DAY_SHORT = ['Ne', 'Po', 'Ut', 'St', 'Št', 'Pi', 'So'];
const dayLabel = i => i === 0 ? 'Dnes' : i === -1 ? 'Včera' : i === 1 ? 'Zajtra' : (d => `${DAY_SHORT[d.getDay()]} ${d.getDate()}. ${d.getMonth() + 1}.`)(new Date(sod(Date.now()) + i * 864e5 + 12 * 3600e3));
const dayWord = t => dayLabel(dayIdx(t));
const plural = (n, one, few, many) => n === 1 ? one : n >= 2 && n <= 4 ? few : many;
const countTxt = n => `${n} ${plural(n, 'kanál', 'kanály', 'kanálov')}`;
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- Logos & tiles ---------- */
const fit = (base, k) => Math.min(base, k).toFixed(2);
function logoHTML(ch) {
  if (ch.logoUrl && !BAD_LOGOS.has(ch.logoUrl)) return `<img class="lg-img" src="${esc(imgUrl(ch.logoUrl))}" alt="" loading="lazy" decoding="async" data-logo="${esc(ch.logoUrl)}">`;
  if (!ch.logo) return nameLogo(ch.name);
  const [s, a, b] = ch.logo;
  switch (s) {
    case 'num': return `<span class="lg lg-num"><b>${a}</b><i>${b}</i></span>`;
    case 'word': return `<span class="lg lg-word" style="font-size:${fit(1.2, 5.4 / (0.66 * a.length + 0.4))}em">${a}<b>.</b></span>`;
    case 'plus': return `<span class="lg lg-plus" style="font-size:${fit(1.05, 5.2 / (0.8 * a.length + 0.7))}em">${a}<b>+</b></span>`;
    case 'pill': return `<span class="lg lg-pill"><span>${a}${b ? `<b>${b}</b>` : ''}</span></span>`;
    case 'sport': return `<span class="lg lg-sport">${a ? `<i>${a}</i>` : ''}<b class="${a ? '' : 'solo'}">${b}</b></span>`;
    case 'serif': return `<span class="lg lg-serif" style="font-size:${fit(1.6, 5.4 / (0.5 * a.length))}em">${a}</span>`;
    case 'circle': return `<span class="lg lg-circle"><b>${a}</b><i>${b}</i></span>`;
    case 'stack': return `<span class="lg lg-stack"><b>${a}</b><b>${b}</b></span>`;
  }
  return '';
}
function nameLogo(name) {
  const t = name.replace(/\s*\b(f?hd|uhd|4k|sd|hevc)\b\s*/ig, ' ').trim() || name;
  return `<span class="lg lg-name" style="font-size:${fit(1.2, 9 / Math.max(4, t.length))}em">${esc(t)}</span>`;
}
const tileStyle = ch => `--c1:${ch.c1};--c2:${ch.c2}`;
const hasImg = ch => !!(ch.logoUrl && !BAD_LOGOS.has(ch.logoUrl));
const tileStatic = (ch, cls = '') => `<span class="tile ${cls}${hasImg(ch) ? ' img' : ''}" style="${tileStyle(ch)}">${logoHTML(ch)}<span class="t-num">${ch.n}</span></span>`;
const tileBtn = ch => `<button class="tile f" data-act="play" data-ch="${ch.id}" data-group="main" aria-label="${ch.n} ${esc(ch.name)}" style="${tileStyle(ch)}">${logoHTML(ch)}<span class="t-num">${ch.n}</span></button>`;
const initials = name => { const w = name.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/); name = w.join('') || name; return (w.length > 1 ? w[0][0] + w[1][0] : name.slice(0, 2)).toUpperCase(); };
const catIcon = s => s.icon === 'auto' ? `<span class="txt-ic">${esc(initials(s.name))}</span>` : s.icon.startsWith('txt:') ? `<span class="txt-ic">${s.icon.slice(4)}</span>` : I(s.icon);

/* ---------- State ---------- */
const ACCENTS = { white: ['#FFFFFF', '#0A0A17'], amber: ['#F2B84B', '#1B1406'], coral: ['#FF7A59', '#1E0B05'], mint: ['#4FD1A5', '#04170F'], violet: ['#A08CFF', '#0F0A24'], ice: ['#7CC4FF', '#03121F'] };
const PALETTE = ['#2F6BFF', '#E5394B', '#8B5CF6', '#16A34A', '#F59E0B', '#EC4899', '#0EA5A4', '#F97316'];
const ICONS = ['auto', 'film', 'ball', 'news', 'kids', 'globe', 'note', 'cup', 'heart', 'sparkle'];
const DEFAULT_SET = { look: 'classic', secRows: '2', tile: 'm', round: 'med', tilebg: 'tint', nums: 'off', caps: 'on', accent: 'white', hide: '5', lang: 'sk', subs: 'off', resume: 'off', backMini: 'off' };
function defaultSections() {
  return [
    { id: 'recent', type: 'recent', name: 'Naposledy pozerané', color: '#94A3B8', icon: 'hist', show: true },
    { id: 'fav', type: 'fav', name: 'Obľúbené', color: '#FF4F5A', icon: 'heart', show: true, chs: DEFAULTS.fav.filter(id => byId[id]) },
    ...GROUPS.map(g => ({ id: g.id, type: 'cat', name: g.name, color: g.color, icon: g.icon, show: true, chs: CH.filter(c => c.cat === g.id).map(c => c.id) })),
  ];
}
/** Saved sections merged with the current playlist: new groups and channels appear, vanished ones go. */
function loadSections(k) {
  const st = store.get('sections:' + k, null);
  if (!Array.isArray(st) || !st.find(s => s.id === 'fav')) return defaultSections();
  const groupIds = new Set(GROUPS.map(g => g.id));
  const out = st.filter(s => s.type !== 'cat' || s.custom || groupIds.has(s.id));
  out.forEach(s => { if (s.chs) s.chs = s.chs.filter(id => byId[id]); });
  for (const g of GROUPS) {
    const members = CH.filter(c => c.cat === g.id).map(c => c.id);
    const s = out.find(x => x.id === g.id);
    if (!s) out.push({ id: g.id, type: 'cat', name: g.name, color: g.color, icon: g.icon, show: true, chs: members });
    else { const have = new Set(s.chs); members.forEach(id => { if (!have.has(id)) s.chs.push(id); }); }
  }
  if (!out.find(s => s.id === 'recent')) out.unshift(defaultSections()[0]);
  return out;
}
function loadOrder(k) {
  const st = store.get('order:' + k, null);
  const o = Array.isArray(st) ? st.filter(id => byId[id]) : [];
  const have = new Set(o);
  let fresh = CH.filter(c => !have.has(c.id));
  if (!o.length && fresh.some(c => c.chno)) fresh = fresh.slice().sort((x, y) => (x.chno || 1e9) - (y.chno || 1e9));
  fresh.forEach(c => o.push(c.id));
  return o;
}
const S = {
  screen: 'home',
  libKey: 'demo', order: [], sections: [], quick: [], recent: [], rem: new Set(), libStatus: '',
  set: Object.assign({}, DEFAULT_SET, store.get('settings3', {})),
  ambCh: null, chipCh: 'all', chipGuide: 'all', catId: null, orgSel: 'quick',
};
const secById = id => S.sections.find(s => s.id === id);
const ordered = () => S.order.map(id => byId[id]);
const favIds = () => (secById('fav') || { chs: [] }).chs;
const isFav = id => favIds().includes(id);
function renumber() { S.order.forEach((id, i) => { byId[id].n = i + 1; }); }
function save() { const k = S.libKey; store.set('order:' + k, S.order); store.set('sections:' + k, S.sections); store.set('quick:' + k, S.quick); rebuildLock(); }
/** Rebuild everything that depends on the channel list, keeping the user's own arrangement. */
function reconcile() {
  const k = S.libKey;
  S.order = loadOrder(k); renumber();
  S.sections = loadSections(k);
  S.quick = (store.get('quick:' + k, null) || DEFAULTS.quick).filter(id => secById(id));
  S.recent = (store.get('recent:' + k, null) || DEFAULTS.recent).filter(id => byId[id]);
  S.rem = new Set(store.get('rem:' + k, []));
  LOCK = Object.assign({ cats: [], chans: [] }, store.get('lock:' + k, {}));
  rebuildLock();
}

/* ---------- Parental lock ---------- */
// The PIN is a household lock, not real security: it is kept hashed in this device's storage.
let LOCK = { cats: [], chans: [] }, LOCKED = new Set(), UNLOCKED = false, PINE = null;
const pinHash = () => store.get('pin', '');
const hashPin = v => 'p' + hashStr('vysielac:' + v).toString(36);
function rebuildLock() {
  LOCKED = new Set(LOCK.chans.filter(id => byId[id]));
  for (const sid of LOCK.cats) { const s = secById(sid); if (s) for (const c of secList(s)) LOCKED.add(c.id); }
}
function saveLock() { store.set('lock:' + S.libKey, LOCK); rebuildLock(); }
const lockedCfg = id => !!pinHash() && LOCKED.has(id);
const isLocked = id => lockedCfg(id) && !UNLOCKED;
/** Ask for the PIN (or a new one with mode 'set'), then run ok(). */
function askPin(ok, { title = 'Zadaj PIN', sub = 'Tento obsah je zamknutý rodičovským zámkom.', mode = 'check' } = {}) {
  PINE = { val: '', ok, mode, first: '', title, sub };
  openModal(pinHTML());
}
function pinHTML() {
  const e = PINE, dots = [0, 1, 2, 3].map(i => `<i class="${i < e.val.length ? 'on' : ''}"></i>`).join('');
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'x'].map(k => k === 'del' ? `<button class="pin-k f" data-act="pin-del" aria-label="Zmazať">${I('back')}</button>`
    : k === 'x' ? `<button class="pin-k f" data-act="close-modal" aria-label="Zrušiť">${I('x')}</button>` : `<button class="pin-k f" data-act="pin-d" data-v="${k}">${k}</button>`).join('');
  return `<div class="pin-box">${I('lock')}<h2>${e.mode === 'set' ? (e.first ? 'Zopakuj nový PIN' : 'Nový PIN (4 číslice)') : e.title}</h2><p class="muted" id="pinSub">${e.mode === 'set' ? 'PIN si zapamätaj, bez neho zámok nezrušíš.' : e.sub}</p>
    <div class="pin-dots" id="pinDots">${dots}</div><div class="pin-pad">${keys}</div></div>`;
}
function pinDraw(msg) {
  $('#pinDots').innerHTML = [0, 1, 2, 3].map(i => `<i class="${i < PINE.val.length ? 'on' : ''}"></i>`).join('');
  if (msg) { $('#pinSub').textContent = msg; const d = $('#pinDots'); d.classList.remove('bad'); void d.offsetWidth; d.classList.add('bad'); }
}
function pinDigit(d) {
  const e = PINE; if (!e) return;
  if (d === 'del') { e.val = e.val.slice(0, -1); pinDraw(); return; }
  if (e.val.length >= 4) return;
  e.val += d; pinDraw();
  if (e.val.length < 4) return;
  setTimeout(() => {
    if (PINE !== e) return;
    if (e.mode === 'set') {
      if (!e.first) { e.first = e.val; e.val = ''; $('#dialog').innerHTML = pinHTML(); setFocus($('#dialog .pin-k')); return; }
      if (e.first !== e.val) { e.first = ''; e.val = ''; $('#dialog').innerHTML = pinHTML(); setFocus($('#dialog .pin-k')); pinDraw('PIN sa nezhodoval, zadaj ho znova.'); return; }
      store.set('pin', hashPin(e.val));
    } else if (hashPin(e.val) !== pinHash()) { e.val = ''; pinDraw('Nesprávny PIN, skús znova.'); return; }
    PINE = null; closeModal(); e.ok();
  }, 120);
}
/** Run fn when allowed: right away if nothing is locked or already unlocked, otherwise after the PIN. */
function withPin(fn, opts) { if (!pinHash() || UNLOCKED) fn(); else askPin(() => { UNLOCKED = true; fn(); }, opts); }
function toggleChannelLock(id) {
  const apply = () => {
    const on = !LOCK.chans.includes(id);
    LOCK.chans = on ? [...LOCK.chans, id] : LOCK.chans.filter(x => x !== id); saveLock();
    toast(on ? `${byId[id].name} je zamknutý` : `${byId[id].name} je odomknutý`);
    if (S.screen === 'home') renderHome(); else if (!P.open) go(S.screen);
  };
  if (!pinHash()) askPin(() => { UNLOCKED = true; apply(); renderLockRows(); }, { mode: 'set' });
  else withPin(apply, { sub: 'Na zmenu zámku treba PIN.' });
}
function openLockCats() {
  const list = S.sections.filter(s => s.type !== 'recent');
  openModal(`<h2>Zamknuté kategórie</h2><p class="muted">Kanály v zamknutých kategóriách si pri spustení vypýtajú PIN.</p><div class="menu-list">`
    + list.map(s => `<button class="mitem f" data-act="lock-cat" data-id="${s.id}">${I(LOCK.cats.includes(s.id) ? 'lock' : 'unlock')}<span>${esc(s.name)}</span><small>${countTxt(secList(s).length)}</small></button>`).join('')
    + `</div><div class="actions"><button class="btn primary f" data-act="close-modal">Hotovo</button></div>`);
}
function lockRows() {
  const has = !!pinHash();
  const cats = LOCK.cats.filter(id => secById(id)).length, chans = LOCK.chans.filter(id => byId[id]).length;
  return setRow('PIN', has ? `Zámok je ${UNLOCKED ? 'teraz odomknutý (do zatvorenia appky)' : 'zapnutý'}` : 'Bez PIN-u sa nič nezamyká',
      has ? `<div class="actions">${UNLOCKED ? `<button class="btn small-btn f" data-act="lock-now" data-group="main">${I('lock')}Zamknúť</button>` : ''}<button class="btn small-btn f" data-act="pin-change" data-group="main">Zmeniť PIN</button><button class="btn small-btn f" data-act="pin-remove" data-group="main">${I('trash')}Zrušiť zámok</button></div>`
        : `<button class="btn small-btn primary f" data-act="pin-change" data-group="main">${I('lock')}Nastaviť PIN</button>`)
    + (has ? setRow('Zamknuté kategórie', cats ? `${cats} ${plural(cats, 'kategória', 'kategórie', 'kategórií')}` : 'Žiadne', `<button class="btn small-btn f" data-act="lock-cats" data-group="main">Vybrať</button>`)
      + setRow('Zamknuté kanály', `${chans ? countTxt(chans) + ' · ' : ''}Kanál zamkneš podržaním OK (alebo pravým klikom) na kanáli → Zamknúť`, '') : '');
}
function renderLockRows() { const el = $('#lockRows'); if (el) el.innerHTML = lockRows(); }
const hashStr = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
function groupMeta(name, i) {
  const n = norm(name);
  let icon = 'auto';
  if (/(^|\W)(sk|svk|slovak|sloven)/.test(n)) icon = 'txt:SK';
  else if (/(^|\W)(cz|cze|czech|cesk|cesko|cr)(\W|$)|cesk/.test(n)) icon = 'txt:CZ';
  else if (/sport|futbal|football|hokej|hockey|arena|tenis|nova sport|eurosport/.test(n)) icon = 'ball';
  else if (/film|movie|cinema|kino|serial|series|hbo|filmbox|amc/.test(n)) icon = 'film';
  else if (/news|sprav|zprav|info|spravodaj/.test(n)) icon = 'news';
  else if (/kid|deti|child|cartoon|junior|disney|nick|rozpravk|pohadk/.test(n)) icon = 'kids';
  else if (/doc|dokument|discovery|nature|priroda|history|nat geo|national geographic|viasat/.test(n)) icon = 'globe';
  else if (/music|hudba|mtv|radio|hit/.test(n)) icon = 'note';
  else if (/life|lifestyle|food|cook|varen|vaŕ|travel|home|dom/.test(n)) icon = 'cup';
  return { color: PALETTE[i % PALETTE.length], icon };
}
const CH_COLORS = ['#3D7BFF', '#E5394B', '#8B5CF6', '#14A3A1', '#F28C28', '#EC4899', '#2F9E5B', '#5B6CFF', '#D9466F', '#0EA5E9', '#B45309', '#7C3AED'];
const LOGO_COLORS = new Map(Object.entries(store.get('logoColors', {})));
let BAD_LOGOS = new Set();
function useLibrary(lib, epg) {
  LIB = lib;
  const groups = [], gid = new Map();
  CH = lib.channels.map(c => {
    if (!gid.has(c.group)) { const id = 'g' + hashStr(c.group).toString(36); gid.set(c.group, id); groups.push({ id, name: c.group, ...groupMeta(c.group, groups.length) }); }
    const h = hashStr(c.name), col = LOGO_COLORS.get(c.logoUrl);
    const ok = Array.isArray(col) && col[0] && col[1];
    return { ...c, cat: gid.get(c.group), c1: ok ? col[0] : CH_COLORS[h % CH_COLORS.length], c2: ok ? col[1] : CH_COLORS[(h >>> 5) % CH_COLORS.length] };
  });
  GROUPS = groups;
  catName = Object.fromEntries(groups.map(g => [g.id, g.name]));
  byId = Object.fromEntries(CH.map(c => [c.id, c]));
  EPG = {}; EPG_RAW = epg || null; epgCache.clear();
  DEFAULTS = { fav: [], recent: [], quick: groups.slice(0, 8).map(g => g.id) };
  S.libKey = 'pl';
  reconcile();
}
function useDemo() {
  const d = buildDemo();
  LIB = null;
  CH = d.channels; GROUPS = d.groups;
  catName = Object.fromEntries(d.groups.map(g => [g.id, g.name]));
  byId = Object.fromEntries(CH.map(c => [c.id, c]));
  EPG = d.epg; EPG_RAW = null; epgCache.clear();
  DEFAULTS = d.defaults;
  S.libKey = 'demo';
  reconcile();
}
function secList(s) {
  if (!s) return [];
  if (s.type === 'recent') return S.recent.map(id => byId[id]).filter(Boolean);
  return (s.chs || []).map(id => byId[id]).filter(Boolean);
}

const AUDIO = [['sk', 'Slovenčina', 'Dolby Digital 5.1'], ['cs', 'Čeština', 'Stereo'], ['en', 'English', 'Dolby Digital 5.1'], ['orig', 'Pôvodné znenie', 'Stereo']];
const SUBS = [['off', 'Vypnuté', ''], ['sk', 'Slovenské', 'DVB titulky'], ['en', 'English', 'Teletext 888']];
const QUAL = [['auto', 'Automaticky', 'Podľa rýchlosti siete'], ['1080', '1080p', 'Full HD · 8 Mb/s'], ['720', '720p', 'HD · 4 Mb/s'], ['576', '576p', 'SD · 2 Mb/s']];
const ASPECT = [['fit', 'Prispôsobiť', 'Celý obraz, prípadne s pásmi'], ['zoom', 'Priblížiť', 'Vyplní obrazovku, okraje sa orežú'], ['fill', 'Roztiahnuť', 'Vyplní obrazovku, obraz sa deformuje'], ['43', '4:3', 'Pre staršie relácie']];
const label = (list, v) => (list.find(x => x[0] === v) || list[0])[1];

function applySettings() {
  const r = document.documentElement, s = S.set;
  if (s.round === 'circle') s.round = 'strong';
  if (!ACCENTS[s.accent]) s.accent = 'white';
  r.dataset.look = s.look; r.dataset.caps = s.caps; r.dataset.tile = s.tile; r.dataset.round = s.round; r.dataset.tilebg = s.tilebg; r.dataset.nums = s.nums;
  const [a, ai] = ACCENTS[s.accent] || ACCENTS.amber;
  r.style.setProperty('--accent', a); r.style.setProperty('--accent-ink', ai);
  store.set('settings3', s);
}

/* ---------- Toast ---------- */
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2600); }

/* ---------- Spatial navigation ---------- */
const nav = { cur: null, mem: {} };
const app = $('#app'), player = $('#player'), osd = $('#osd'), chPanel = $('#chPanel'), sheet = $('#sheet'), modal = $('#modal'), home = $('#s-home');
const visible = el => el && el.isConnected && !el.disabled && el.getClientRects().length > 0;
function activeRoot() {
  if (!modal.hidden) return modal;
  if (P.open && !P.mini) { if (P.panel) return P.panel === 'list' ? chPanel : sheet; return P.osd ? osd : P.error ? $('#pStatus') : null; }
  return app;
}
function setFocus(el, opts = {}) {
  if (!el) return;
  if (nav.cur && nav.cur !== el) nav.cur.classList.remove('focus');
  nav.cur = el; el.classList.add('focus');
  if (document.activeElement !== el) { try { el.focus({ preventScroll: true }); } catch (e) {} }
  const g = el.dataset.group;
  if (g) nav.mem[g === 'main' ? 'main:' + S.screen : g] = el;
  if (!opts.noScroll) ensureVisible(el);
  onFocus(el);
}
function clearFocus() { if (nav.cur) nav.cur.classList.remove('focus'); nav.cur = null; }
/* Find the element that replaced `el` after a re-render (same data attributes, same section). */
const TWIN_KEYS = ['act', 'ch', 'sec', 'id', 'list', 'k', 'v', 'screen', 'which', 'start'];
function twin(el) {
  if (!el) return null;
  if (el.isConnected) return el;
  const d = el.dataset;
  const sel = TWIN_KEYS.filter(k => d[k] !== undefined).map(k => `[data-${k}="${CSS.escape(d[k])}"]`).join('');
  if (!sel) return null;
  const scope = el.closest('[data-secid]');
  if (scope) { const s = $(`[data-secid="${CSS.escape(scope.dataset.secid)}"]`); const f = s && $(sel, s); if (f) return f; }
  return $(sel);
}
const relTop = (el, sc) => el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
function ensureVisible(el) {
  const behavior = reduceMotion ? 'auto' : 'smooth';
  const sc = el.closest('.hscroll');
  if (sc) {
    const pad = 60, x = el.offsetLeft, w = el.offsetWidth;
    if (x - sc.scrollLeft < pad) sc.scrollTo({ left: x - pad, behavior });
    else if (x + w - sc.scrollLeft > sc.clientWidth - pad) sc.scrollTo({ left: x + w - sc.clientWidth + pad, behavior });
  }
  if (home.contains(el) && isWide()) {
    if (el.closest('#hero, #pills')) { home.scrollTo({ top: 0, behavior }); return; }
    const sec = el.closest('.sec');
    if (sec) {
      let top = relTop(sec, home) - 16;
      const bottom = relTop(el, home) + el.offsetHeight + 40;
      if (bottom - top > home.clientHeight) top = bottom - home.clientHeight;
      home.scrollTo({ top: Math.max(0, top), behavior });
      return;
    }
  }
  if (sc) { (sc.closest('.sec') || sc).scrollIntoView({ block: 'nearest', behavior }); return; }
  el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior });
}
function move(dir) {
  const root = activeRoot(); if (!root) return false;
  const extra = root === app && P.mini ? $('#miniBar') : null;
  const inRoot = el => root.contains(el) || (extra && extra.contains(el));
  const cur = nav.cur && inRoot(nav.cur) && visible(nav.cur) ? nav.cur : null;
  const items = [...$$('.f', root), ...(extra ? $$('.f', extra) : [])].filter(visible);
  if (!cur) { setFocus(root === app ? pickDefault() : items[0]); return true; }
  const r = cur.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let best = null, bs = Infinity;
  for (const el of items) {
    if (el === cur) continue;
    const c = el.getBoundingClientRect(), ex = c.left + c.width / 2, ey = c.top + c.height / 2;
    let p, g, d;
    if (dir === 'left' || dir === 'right') {
      if (dir === 'right' ? ex <= cx + 1 : ex >= cx - 1) continue;
      p = dir === 'right' ? c.left - r.right : r.left - c.right;
      g = Math.max(0, c.top - r.bottom, r.top - c.bottom); d = Math.abs(ey - cy);
    } else {
      if (dir === 'down' ? ey <= cy + 1 : ey >= cy - 1) continue;
      p = dir === 'down' ? c.top - r.bottom : r.top - c.bottom;
      g = Math.max(0, c.left - r.right, r.left - c.right); d = Math.abs(ex - cx);
    }
    const s = Math.max(0, p) + g * 3 + d * 0.05;
    if (s < bs) { bs = s; best = el; }
  }
  if (!best) {
    if (dir === 'down' || dir === 'right') for (const box of lazyBoxes()) if (box && root.contains(box) && box.contains(cur) && lazyMore(box)) return move(dir);
    return false;
  }
  const cg = cur.dataset.group, bg = best.dataset.group;
  if (bg && bg !== cg) {
    const m = nav.mem[bg === 'main' ? 'main:' + S.screen : bg];
    if (m && visible(m) && inRoot(m)) best = m;
    else if (bg === 'nav') best = $('#topnav .nav-item.active') || best;
  }
  setFocus(best);
  return true;
}
function pickDefault() {
  const m = nav.mem['main:' + S.screen];
  if (m && visible(m)) return m;
  if (S.screen === 'home') return $('#hero .bcard') || $('#sections .card');
  if (S.screen === 'guide') return $('#gScroll .prog.now') || $('#gScroll .prog');
  if (S.screen === 'channels') return $('#chGrid .card') || $('#chChips .chip');
  if (S.screen === 'cat') return $('#catGrid .card') || $('#catActions .f');
  if (S.screen === 'search') return $('#q');
  if (S.screen === 'organize') return $(`#orgLeft .org-main[data-id="${S.orgSel}"]`) || $('#orgLeft .f');
  return $('.f', $('#s-' + S.screen));
}
let ambT;
function onFocus(el) {
  $$('.sec.has-focus').forEach(r => r.classList.remove('has-focus'));
  const sec = el.closest('#sections .sec'); if (sec) sec.classList.add('has-focus');
  const ch = el.dataset.ch && byId[el.dataset.ch];
  if (ch && el.closest('#s-home, #s-cat, #s-channels')) { clearTimeout(ambT); ambT = setTimeout(() => setAmbient(ch), 140); }
  if (el.classList.contains('prog')) renderGDetail(el);
}

/* ---------- Screens ---------- */
const RAIL_FOR = { cat: 'home', organize: 'settings' };
function go(name, focus = true) {
  const prev = nav.mem['main:' + name];
  S.screen = name;
  $$('main .screen').forEach(s => { s.hidden = s.dataset.screen !== name; });
  $$('#topnav .nav-item').forEach(b => b.classList.toggle('active', b.dataset.screen === (RAIL_FOR[name] || name)));
  if (name === 'home') renderHome();
  if (name === 'cat') renderCat();
  if (name === 'channels') renderChannels();
  if (name === 'guide') renderGuide();
  if (name === 'search') renderResults();
  if (name === 'settings') renderSettings();
  if (name === 'organize') renderOrganizer();
  if (name === 'recs') { renderRecs(); refreshRecs(); }
  if (focus) { nav.cur = nav.cur && nav.cur.isConnected ? nav.cur : null; setFocus((prev && twin(prev)) || pickDefault()); }
}

/* Home */
function fitGrid(box) {
  const w = box.clientWidth || home.clientWidth;
  const t = $('#probeCard').offsetWidth, g = $('#probeGap').offsetWidth;
  const cols = Math.max(1, Math.floor((w + g) / (t + g)));
  box.style.setProperty('--card', Math.floor((w - (cols - 1) * g) / cols) + 'px');
  box.style.setProperty('--cols', cols);
  return cols;
}
const artHTML = ch => `<span class="art${hasImg(ch) ? ' img' : ''}" style="${tileStyle(ch)}">${logoHTML(ch)}<span class="t-num">${ch.n}</span>${lockedCfg(ch.id) ? `<span class="lock-b">${I('lock')}</span>` : ''}</span>`;
function capHTML(ch, now = Date.now()) {
  const p = progAt(ch.id, now);
  if (p.none) return `<span class="cap"><b>${esc(ch.name)}</b><small>${ch.n} · ${esc(catName[ch.cat] || '')}</small></span>`;
  return `<span class="cap"><b>${esc(p.title)}</b><small>${ch.n} · ${esc(ch.name)} · do ${hm(p.end)}</small><span class="pbar"><i style="width:${frac(p, now) * 100}%"></i></span></span>`;
}
const cardBtn = ch => `<button class="card f" data-act="play" data-ch="${ch.id}" data-group="main" aria-label="${ch.n} ${esc(ch.name)}">${artHTML(ch)}${capHTML(ch)}</button>`;
const cardStatic = ch => `<span class="card">${artHTML(ch)}${capHTML(ch)}</span>`;
const moreCard = (s, n) => `<button class="card more f" data-act="cat" data-sec="${s.id}" data-group="main"><span class="art" style="--c1:${s.color};--c2:${s.color}"><span class="more-in"><b>+${n}</b><small>Zobraziť všetky</small></span></span><span class="cap"><b>${esc(s.name)}</b><small>Celá sekcia · ${countTxt(secList(s).length)}</small></span></button>`;
function updateCaps() { const now = Date.now(); $$('.card[data-ch]').forEach(c => { const cap = $('.cap', c); if (cap) cap.outerHTML = capHTML(byId[c.dataset.ch], now); }); }
/* Favourites live in the big banners; without any, the banners show what is on now. */
function featured() {
  const f = secById('fav');
  if (f && f.show && secList(f).length) return { fav: true, title: f.name, list: secList(f) };
  const ids = [];
  ['sport', 'film', 'news'].forEach(k => { const s = secById(k); if (s) s.chs.forEach(id => { if (ids.length < 6 && !ids.includes(id)) ids.push(id); }); });
  for (const id of S.order) { if (ids.length >= 6) break; if (!ids.includes(id)) ids.push(id); }
  return { fav: false, title: 'Teraz v TV', list: ids.map(id => byId[id]).filter(Boolean) };
}
function bannerHTML(ch, now) {
  const p = progAt(ch.id, now);
  const img = hasImg(ch);
  return `<button class="bcard f${img ? ' img' : ''}" data-act="play" data-ch="${ch.id}" data-group="main" style="${tileStyle(ch)}"><span class="b-art">${img ? `<img class="b-blur" src="${esc(imgUrl(ch.logoUrl))}" alt="" loading="lazy" decoding="async">` : ''}${logoHTML(ch)}</span>`
    + `<span class="b-txt"><span class="b-eyebrow"><span class="badge live-w"><i class="dot"></i>Živé</span>${p.none ? `Kanál ${ch.n}` : `${ch.n} · ${esc(ch.name)}`}</span>`
    + `<b class="b-title">${esc(p.none ? ch.name : p.title)}</b><span class="b-meta">${p.none ? esc(catName[ch.cat] || '') : `${hm(p.start)} – ${hm(p.end)}${p.genre ? ' · ' + esc(p.genre) : ''} · ${remain(p, now)}`}</span>`
    + `<span class="b-play"><i>${I('play')}</i>Pozerať</span></span></button>`;
}
const pillHTML = s => `<button class="pill f" data-act="cat" data-sec="${s.id}" data-group="main" style="--pc:${s.color}">${catIcon(s)}${esc(s.name)}</button>`;
function secHTML(s, limit) {
  const list = secList(s);
  if (!list.length && s.type === 'recent') return '';
  const head = `<div class="sec-head"><h3>${esc(s.name)}</h3><span class="sec-count">${countTxt(list.length)}</span></div>`;
  let body;
  if (s.type === 'recent') body = `<div class="hscroll scroller">${list.map(cardBtn).join('')}</div>`;
  else if (!list.length) body = `<p class="sec-empty">${s.type === 'fav' ? 'Zatiaľ žiadne obľúbené. Pridáš ich srdiečkom v prehrávači alebo v Nastaveniach → Sekcie a kanály.' : 'Prázdna kategória. Kanály pridáš v Nastaveniach → Sekcie a kanály.'}</p>`;
  else {
    const over = list.length > limit, shown = over ? list.slice(0, limit - 1) : list;
    body = `<div class="cgrid">${shown.map(cardBtn).join('')}${over ? moreCard(s, list.length - shown.length) : ''}</div>`;
  }
  return `<section class="sec" data-secid="${s.id}">${head}${body}</section>`;
}
const hkey = sc => sc.id || (sc.closest('.sec') || {}).dataset?.secid;
function renderHome(prefer) {
  const ref = prefer || nav.cur;
  const keepX = {};
  $$('#s-home .hscroll').forEach(sc => { keepX[hkey(sc)] = sc.scrollLeft; });
  const now = Date.now();
  const F = featured(), feat = F.list;
  $('#heroHead').innerHTML = `${F.fav ? I('heart-f') : ''}<h3>${esc(F.title)}</h3><span class="sec-count">${countTxt(feat.length)}</span>`;
  $('#hero').innerHTML = feat.map(c => bannerHTML(c, now)).join('');
  $('#pills').innerHTML = S.quick.map(secById).filter(Boolean).map(pillHTML).join('')
    + `<button class="pill f" data-act="screen" data-screen="channels" data-group="main" style="--pc:#9AA4FF">${I('grid')}Všetky kanály</button>`;
  const box = $('#sections');
  const cols = fitGrid(box);
  const rows = Math.max(1, +S.set.secRows || 2);
  box.innerHTML = S.sections.filter(s => s.show && s.type !== 'fav').map(s => secHTML(s, cols * rows)).join('');
  $$('#s-home .hscroll').forEach(sc => { const v = keepX[hkey(sc)]; if (v) sc.scrollLeft = v; });
  if (!S.ambCh && feat[0]) setAmbient(feat[0]);
  if (ref && !ref.isConnected) { const t = twin(ref); nav.cur = null; if (t && S.screen === 'home' && !P.open && modal.hidden) setFocus(t); }
}
function setAmbient(ch) { S.ambCh = ch.id; const a = $('#ambient'); a.style.setProperty('--h1', ch.c1); a.style.setProperty('--h2', ch.c2); }
function renderCat() {
  const s = secById(S.catId); if (!s) return;
  const ic = $('#catIc'); ic.style.setProperty('--sc', s.color); ic.innerHTML = catIcon(s);
  $('#catName').textContent = s.name;
  const list = secList(s);
  $('#catCount').textContent = countTxt(list.length);
  $('#catActions').innerHTML = `<button class="btn small-btn f" data-act="screen" data-screen="home" data-group="main">${I('back')}Domov</button>`
    + (s.type !== 'recent' ? `<button class="btn small-btn f" data-act="org-open" data-id="${s.id}" data-group="main">${I('pencil')}Upraviť kanály a poradie</button>` : '');
  const g = $('#catGrid'); fitGrid(g);
  if (list.length) lazyFill(g, list, cardBtn); else g.innerHTML = `<p class="empty">V tejto sekcii zatiaľ nie sú žiadne kanály.</p>`;
}
const filterCh = v => v === 'all' ? ordered() : secList(secById(v));
const chipsHTML = (which, cur) => [['all', 'Všetky'], ...S.sections.filter(s => s.type !== 'recent').map(s => [s.id, s.name])].map(([v, l]) =>
  `<button class="chip f ${cur === v ? 'on' : ''}" data-act="chip" data-which="${which}" data-v="${v}" data-group="main">${esc(l)}</button>`).join('');

function renderChannels() {
  if (S.chipCh !== 'all' && !secById(S.chipCh)) S.chipCh = 'all';
  const keep = nav.cur && nav.cur.closest('#chGrid') ? nav.cur.dataset.ch : null;
  $('#chChips').innerHTML = chipsHTML('ch', S.chipCh);
  const list = filterCh(S.chipCh);
  fitGrid($('#chGrid'));
  if (list.length) lazyFill($('#chGrid'), list, cardBtn); else $('#chGrid').innerHTML = `<p class="empty">Zatiaľ tu nič nie je. Kanály pridáš v Nastaveniach → Sekcie a kanály.</p>`;
  $('#chCount').textContent = countTxt(list.length);
  if (keep) { const el = $(`#chGrid [data-ch="${keep}"]`) || $('#chGrid .card') || $('#chChips .chip.on'); nav.cur = null; setFocus(el); }
}

/* Guide */
let G = { rows: new Map(), list: [] };
let gDay = 0, epgEndC = { raw: undefined, t: 0 };
/** Where the guide data ends, sampled from a few channels (cheap, cached until the EPG changes). */
function epgEnd() {
  if (epgEndC.raw === EPG_RAW && epgEndC.t) return epgEndC.t;
  let t = 0, n = 0;
  for (const c of CH) { const l = epgFor(c.id); if (l && l.length) { t = Math.max(t, l[l.length - 1].end); if (++n >= 40) break; } }
  epgEndC = { raw: EPG_RAW, t };
  return t;
}
/** Days the guide offers: back as far as the longest archive (at least yesterday), forward as far as the EPG reaches. */
function guideDays() {
  const back = Math.min(7, Math.max(1, ...CH.map(c => (c.catchup && c.catchup.days) || 0)));
  const end = epgEnd();
  const fwd = end ? Math.max(0, Math.min(7, dayIdx(end - 1))) : 0;
  const out = []; for (let i = -back; i <= fwd; i++) out.push(i); return out;
}
const ROW_H = 72, HEAD_H = 40;
function guideRowHTML(ch, i) {
  const { ws, we, ppm } = G, now = Date.now();
  const cells = progsIn(ch.id, ws, we).map(p => {
    // A channel without a guide gets one block starting where the guide opens, so its label is in view.
    const l = Math.max(p.start, ws, p.none && !gDay ? now - 40 * MIN : 0), r = Math.min(p.end, we);
    const st = p.none ? 'none' : p.end <= now ? 'past' : p.start <= now ? 'now' : 'future';
    const bell = recFor(ch.id, p.start) ? `<i class="rec-dot"></i>` : S.rem.has(ch.id + ':' + p.start) ? I('bell') : '';
    const noArch = st === 'past' && !hasArchive(ch, p.start) ? ' no-arch' : '';
    return `<button class="prog f ${st}${noArch}" data-act="prog" data-group="main" data-ch="${ch.id}" data-start="${p.start}" data-end="${p.end}" style="left:${(l - ws) / MIN * ppm + 2}px;width:${Math.max(4, (r - l) / MIN * ppm - 4)}px">`
      + (st === 'now' ? `<i class="pf" style="width:${frac(p, now) * 100}%"></i>` : '')
      + (p.none ? `<span class="pt">Program nie je k dispozícii</span><span class="pm">OK spustí kanál</span>` : `<span class="pt">${bell}${esc(p.title)}</span><span class="pm">${hm(p.start)} – ${hm(p.end)}</span>`)
      + `</button>`;
  }).join('');
  return `<div class="g-row" data-i="${i}" style="top:${HEAD_H + i * ROW_H}px"><div class="g-ch">${tileStatic(ch, 'mini')}<b>${ch.n}</b><span class="nm">${esc(ch.name)}</span></div><div class="g-track">${cells}</div></div>`;
}
/** Only the rows near the viewport exist in the DOM, so the guide stays fast with thousands of channels. */
function fillGuideRows() {
  const sc = $('#gScroll'), box = $('#gRows');
  if (!box) return;
  const first = Math.max(0, Math.floor((sc.scrollTop - HEAD_H) / ROW_H) - 8);
  const last = Math.min(G.list.length - 1, Math.ceil((sc.scrollTop + sc.clientHeight) / ROW_H) + 8);
  for (const [i, el] of G.rows) if ((i < first || i > last) && !(nav.cur && el.contains(nav.cur))) { el.remove(); G.rows.delete(i); }
  let html = '';
  for (let i = first; i <= last; i++) if (!G.rows.has(i)) html += guideRowHTML(G.list[i], i);
  if (!html) return;
  box.insertAdjacentHTML('beforeend', html);
  for (const el of box.children) { const i = +el.dataset.i; if (!G.rows.has(i)) G.rows.set(i, el); }
}
function renderGuide(keep) {
  if (S.chipGuide !== 'all' && !secById(S.chipGuide)) S.chipGuide = 'all';
  const sc = $('#gScroll');
  const prevL = sc.scrollLeft, prevT = sc.scrollTop;
  const now = Date.now(), wide = isWide();
  const ppm = wide ? 4.4 : 3, chw = wide ? 230 : 62;
  const days = guideDays();
  if (!days.includes(gDay)) gDay = 0;
  const d0 = sod(now + gDay * 864e5 + (gDay ? 12 * 3600e3 : 0));
  // Today starts 90 minutes back and runs to the small hours; other days cover the whole day.
  const ws = gDay ? d0 : Math.floor((now - 90 * MIN) / (30 * MIN)) * 30 * MIN;
  const we = gDay ? d0 + 24 * 60 * MIN : Math.max(ws + 10 * 60 * MIN, sod(now) + 26 * 60 * MIN);
  const gw = (we - ws) / MIN * ppm;
  G = { ws, we, ppm, chw, list: filterCh(S.chipGuide), rows: new Map() };
  $('#gDate').textContent = dateTxt(d0 + 12 * 3600e3);
  $('#gDays').innerHTML = days.map(i => `<button class="chip f ${i === gDay ? 'on' : ''}" data-act="gday" data-v="${i}" data-group="main">${dayLabel(i)}</button>`).join('');
  $('#gChips').innerHTML = chipsHTML('guide', S.chipGuide);
  let times = '';
  for (let t = ws; t < we; t += 30 * MIN) times += `<span style="left:${(t - ws) / MIN * ppm}px">${hm(t)}</span>`;
  const nowX = (now - ws) / MIN * ppm;
  sc.style.setProperty('--chw', chw + 'px');
  sc.innerHTML = `<div class="g-inner" style="--chw:${chw}px;--gw:${gw}px;height:${HEAD_H + G.list.length * ROW_H + 30}px">`
    + `<div class="g-ruler"><div class="g-corner"></div><div class="g-times">${times}${gDay ? '' : `<em class="g-nowtag" style="left:${nowX}px">teraz</em>`}</div></div>`
    + (G.list.length ? `<div id="gRows"></div>` : `<p class="empty" style="padding-left:${chw}px">V tejto sekcii nie sú žiadne kanály.</p>`)
    + (gDay ? '' : `<div class="now-line" style="left:${chw + nowX}px"></div>`) + `</div>`;
  if (keep) { sc.scrollLeft = prevL; sc.scrollTop = prevT; }
  else { sc.scrollLeft = gDay ? (19 * 60 - 30) * ppm : Math.max(0, nowX - 40 * ppm); sc.scrollTop = 0; }
  fillGuideRows();
  const first = gDay ? guideFirstVisible() : $('#gScroll .prog.now') || $('#gScroll .prog');
  if (first) renderGDetail(first); else $('#gDetail').innerHTML = '';
}
function guideFirstVisible() {
  const sc = $('#gScroll'), x = sc.getBoundingClientRect().left + G.chw + 20;
  return $$('#gScroll .g-row')[0] && [...$$('#gScroll .g-row')[0].querySelectorAll('.prog')].find(p => p.getBoundingClientRect().right > x) || $('#gScroll .prog');
}
function renderGDetail(el) {
  const ch = byId[el.dataset.ch], start = +el.dataset.start;
  if (!ch) return;
  const p = findProg(ch.id, start);
  const now = Date.now();
  if (p.none) {
    $('#gDetail').innerHTML = `${tileStatic(ch, 'mini')}<div><div class="eyebrow"><span class="badge live"><i class="dot"></i>Živé</span><span>${ch.n} · ${esc(ch.name)}</span></div>`
      + `<h3>${esc(ch.name)}</h3><div class="meta"><span>${esc(catName[ch.cat] || '')}</span></div><p>Pre tento kanál nie je k dispozícii program (EPG).</p><div class="g-hint"><b>OK</b> pozerať naživo</div></div>`;
    return;
  }
  const st = p.end <= now ? 'past' : p.start <= now ? 'now' : 'future';
  const rem = S.rem.has(ch.id + ':' + p.start);
  const arch = hasArchive(ch, p.start);
  const badge = st === 'past' ? (arch ? `<span class="badge arch">${I('hist')}Archív</span>` : `<span class="badge">Bez archívu</span>`)
    : st === 'now' ? `<span class="badge live"><i class="dot"></i>Živé · ${remain(p, now)}</span>`
    : `<span class="badge">${rem ? I('bell') + 'Pripomienka' : remain(p, now)}</span>`;
  const hint = st === 'past' ? (arch ? 'prehrať z archívu' : 'tento kanál nemá archív, OK spustí živé vysielanie') : st === 'now' ? 'pozerať naživo' : rem ? 'zrušiť pripomienku' : 'pripomenúť';
  $('#gDetail').innerHTML = `${tileStatic(ch, 'mini')}<div><div class="eyebrow">${badge}<span>${ch.n} · ${esc(ch.name)}</span></div>`
    + `<h3>${esc(p.title)}</h3><div class="meta"><span>${dayWord(p.start)} ${hm(p.start)} – ${hm(p.end)}</span><span>${p.genre}</span><span>${Math.round((p.end - p.start) / MIN)} min</span></div>`
    + `<p>${esc(p.desc)}</p><div class="g-hint"><b>OK</b> ${hint}</div></div>`;
}
function updateGuideNow() {
  if (S.screen !== 'guide' || !G.ws) return;
  const now = Date.now(), x = (now - G.ws) / MIN * G.ppm;
  const line = $('#gScroll .now-line'), tag = $('#gScroll .g-nowtag');
  if (line) line.style.left = G.chw + x + 'px';
  if (tag) tag.style.left = x + 'px';
  $$('#gScroll .prog:not(.none)').forEach(c => {
    const s = +c.dataset.start, e = +c.dataset.end;
    const st = e <= now ? 'past' : s <= now ? 'now' : 'future';
    c.classList.remove('past', 'now', 'future'); c.classList.add(st);
    const pf = $('.pf', c);
    if (st === 'now') { if (pf) pf.style.width = frac({ start: s, end: e }, now) * 100 + '%'; }
    else if (pf) pf.remove();
  });
}

/* Search */
/* Channel names first, then programme titles in small batches, so typing never stalls even with 10 000 channels. */
let searchRun = 0;
async function renderResults() {
  const run = ++searchRun;
  const raw = $('#q').value.trim(), q = norm(raw);
  const now = Date.now();
  const box = $('#results');
  if (!q) { box.innerHTML = `<h4>Tvoje obľúbené</h4>` + favIds().map(id => resHTML(byId[id], progAt(id, now))).join(''); return; }
  // Channels by name, then the whole guide: what is on now, what comes later (OK sets a reminder) and what can be replayed.
  const list = ordered(), R = { ch: [], now: [], later: [], past: [] }, CAP = 60;
  for (const c of list) if (R.ch.length < CAP && norm(c.name).includes(q)) R.ch.push(c);
  const show = done => {
    if (run !== searchRun) return;
    const n = R.ch.length + R.now.length + R.later.length + R.past.length;
    const sec = (title, items, fn) => items.length ? `<h4>${title}</h4>` + items.slice(0, CAP).map(fn).join('') : '';
    R.later.sort((a, b) => a.p.start - b.p.start); R.past.sort((a, b) => b.p.start - a.p.start);
    box.innerHTML = (n ? '' : done ? `<p class="empty">Pre „${esc(raw)}“ sme nič nenašli. Skús názov kanála alebo relácie.</p>` : `<h4>Hľadám…</h4>`)
      + sec('Kanály', R.ch, c => resHTML(c, progAt(c.id, now)))
      + sec('Práve beží', R.now, h => resHTML(h.c, h.p))
      + sec('Neskôr · OK nastaví pripomienku', R.later, h => progRes(h.c, h.p, 'later'))
      + sec('Z archívu', R.past, h => progRes(h.c, h.p, 'past'))
      + (done || !n ? '' : `<p class="opt-note">Hľadám v programe…</p>`);
  };
  show(false);
  let total = 0;
  for (let i = 0; i < list.length && total < 4 * CAP; i++) {
    if (i % 150 === 149) { await new Promise(r => setTimeout(r, 0)); if (run !== searchRun) return; }
    const c = list[i], progs = epgFor(c.id) || [];
    for (const p of progs) {
      if (!p.title || !norm(p.title).includes(q)) continue;
      if (p.start <= now && p.end > now) R.now.push({ c, p });
      else if (p.start > now) R.later.push({ c, p });
      else if (hasArchive(c, p.start)) R.past.push({ c, p });
      else continue;
      total++;
    }
  }
  show(true);
}
const resHTML = (c, p, later) => `<button class="res f" data-act="play" data-ch="${c.id}" data-group="main">${tileStatic(c, 'mini')}<span><b>${c.n} · ${esc(c.name)}</b><small>${p.none ? esc(catName[c.cat] || '') : `${later ? 'O ' + hm(p.start) : 'Teraz'}: ${esc(p.title)}`}</small></span></button>`;
const progRes = (c, p, kind) => `<button class="res f" data-act="rprog" data-ch="${c.id}" data-start="${p.start}" data-group="main">${tileStatic(c, 'mini')}<span class="res-i"><b>${esc(p.title)}</b><small>${dayWord(p.start)} ${hm(p.start)} – ${hm(p.end)} · ${esc(c.name)}</small></span><span class="res-st">${kind === 'past' ? I('hist') + 'Archív' : S.rem.has(c.id + ':' + p.start) ? I('bell') + 'Pripomeniem' : ''}</span></button>`;

/* Settings */
const seg = (k, opts) => `<div class="seg">${opts.map(([v, l]) => `<button class="f ${S.set[k] === v ? 'on' : ''}" data-act="set" data-k="${k}" data-v="${v}" data-group="main">${l}</button>`).join('')}</div>`;
const setRow = (title, sub, ctrl) => `<div class="set-row"><div class="lbl"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</div>${ctrl}</div>`;
function renderSettings() {
  const sw = Object.entries(ACCENTS).map(([k, [c]]) => `<button class="swatch f ${S.set.accent === k ? 'on' : ''}" style="--sw:${c}" data-act="set" data-k="accent" data-v="${k}" data-group="main" aria-label="Farba ${k}"></button>`).join('');
  const custom = S.sections.filter(s => s.custom).length;
  $('#settings').innerHTML = `
    <div class="set-group"><h3>Domovská obrazovka</h3>
      ${setRow('Štýl', 'Nočný neón: tmavé pozadie so svetelnými vlnami. Liquid glass: sklenený panel nad rozmazanou farbou, na starších TV môže byť pomalší.', seg('look', [['classic', 'Nočný neón'], ['glass', 'Liquid glass']]))}
      ${setRow('Riadkov v sekciách', 'Naposledy pozerané je vždy jeden riadok', seg('secRows', [['1', '1'], ['2', '2'], ['3', '3']]))}
      ${setRow('Sekcie, kategórie a poradie kanálov', `${S.sections.length - 2} ${plural(S.sections.length - 2, 'kategória', 'kategórie', 'kategórií')}${custom ? `, z toho ${custom} vlastné` : ''} · ${S.quick.length} ${plural(S.quick.length, 'tlačidlo', 'tlačidlá', 'tlačidiel')} na vrchu`, `<button class="btn small-btn f" data-act="org-open" data-group="main">${I('pencil')}Upraviť</button>`)}
    </div>
    <div class="set-group"><h3>Playlist</h3>
      ${playlistRows()}
    </div>
    <div class="set-group"><h3>Kanály</h3>
      <div class="preview">${['Tatra 1', 'Šport Live 1', 'Kino Max', 'Vltava 1'].map(n => cardStatic(byId[idOf(n)])).join('')}</div>
      ${setRow('Veľkosť kanálov', '', seg('tile', [['s', 'Malé'], ['m', 'Stredné'], ['l', 'Veľké']]))}
      ${setRow('Zaoblenie rohov', '', seg('round', [['soft', 'Jemné'], ['med', 'Stredné'], ['strong', 'Výrazné']]))}
      ${setRow('Pozadie kanálov', 'Skutočné logá z playlistu bývajú priehľadné PNG', seg('tilebg', [['tint', 'Farba kanála'], ['dark', 'Tmavé'], ['light', 'Svetlé']]))}
      ${setRow('Farba zvýraznenia', 'Rámik okolo vybranej položky', `<div class="swatches">${sw}</div>`)}
      ${setRow('Relácia pod kanálom', 'Názov a priebeh toho, čo práve beží', `<button class="toggle f ${S.set.caps === 'on' ? 'on' : ''}" data-act="set" data-k="caps" data-v="toggle" data-group="main" aria-label="Relácia pod kanálom"></button>`)}
      ${setRow('Čísla kanálov v rohu', '', `<button class="toggle f ${S.set.nums === 'on' ? 'on' : ''}" data-act="set" data-k="nums" data-v="toggle" data-group="main" aria-label="Čísla kanálov"></button>`)}
    </div>
    <div class="set-group"><h3>Prehrávač</h3>
      ${setRow('Predvolený jazyk zvuku', 'Ak ho stream obsahuje', seg('lang', AUDIO.map(a => [a[0], a[1]])))}
      ${setRow('Predvolené titulky', '', seg('subs', SUBS.map(a => [a[0], a[1]])))}
      ${setRow('Skryť ovládanie po', '', seg('hide', [['3', '3 s'], ['5', '5 s'], ['8', '8 s']]))}
      ${setRow('Po spustení pokračovať', 'Appka hneď pustí naposledy pozeraný kanál, ako set-top box', toggleBtn('resume', 'Po spustení pokračovať'))}
      ${setRow('Späť zmenší do okienka', 'Tlačidlo Späť v prehrávači kanál nezavrie, ale nechá ho hrať v malom okienku. Zavrieš ho tlačidlom Stop alebo opakovaným Späť.', toggleBtn('backMini', 'Späť zmenší do okienka'))}
    </div>
    <div class="set-group"><h3>Rodičovský zámok</h3><div id="lockRows">${lockRows()}</div></div>
    <div class="set-group"><h3>Ostatné</h3>
      ${setRow('Ovládanie', 'Klávesy, diaľkový ovládač a gestá', `<button class="btn small-btn f" data-act="help" data-group="main">Zobraziť</button>`)}
      ${setRow('Obnoviť ukážku', 'Vráti nastavenia, sekcie, obľúbené a históriu do pôvodného stavu', `<button class="btn small-btn f" data-act="reset" data-group="main">Obnoviť</button>`)}
    </div>`;
}
const toggleBtn = (k, label) => `<button class="toggle f ${S.set[k] === 'on' ? 'on' : ''}" data-act="set" data-k="${k}" data-v="toggle" data-group="main" aria-label="${label}"></button>`;
function setSetting(k, v, el) {
  if (v === 'toggle') { v = S.set[k] === 'on' ? 'off' : 'on'; if (el) el.classList.toggle('on', v === 'on'); }
  else $$(`[data-act="set"][data-k="${k}"]`).forEach(b => b.classList.toggle('on', b.dataset.v === v));
  S.set[k] = v;
  if (k === 'lang') P.audio = v;
  if (k === 'subs') P.subs = v;
  applySettings();
  if (k === 'secRows' && S.screen === 'home') renderHome();
  if (k === 'look') toast(v === 'glass' ? 'Liquid glass zapnutý' : 'Klasický vzhľad');
}

/* ---------- Playlist & EPG ---------- */
const mb = b => b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} kB`;
function ago(t) {
  if (!t) return '–';
  const d = new Date(t), today = new Date(); today.setHours(0, 0, 0, 0);
  const day = t >= today.getTime() ? 'dnes' : t >= today.getTime() - 864e5 ? 'včera' : `${d.getDate()}. ${d.getMonth() + 1}.`;
  return `${day} ${hm(t)}`;
}
const plCard = (title, sub) => `<span class="pl-card"><span class="pl-icon">${I('link')}</span><span class="lbl"><b>${esc(title)}</b><small>${sub}</small></span></span>`;
const epgUrls = () => (LIB ? (LIB.source.epg ? [LIB.source.epg] : LIB.header?.tvgUrls || []) : []);
function playlistRows() {
  const status = `<div class="lib-status ${S.libErr ? 'err' : ''} ${S.libBusy ? 'busy' : ''}" id="libStatus" ${S.libStatus ? '' : 'hidden'}><span class="spin"></span><span id="libStatusTxt">${esc(S.libStatus)}</span></div>`;
  const relayNote = useRelay() ? '' : setRow('Beží bez lokálneho servera', 'V prehliadači na PC väčšina IPTV serverov bez neho nefunguje. Spusti appku príkazom npm start (pozri README).', '');
  if (!LIB) return relayNote + setRow(plCard('Ukážkové kanály', 'Vymyslené kanály bez vysielania. Keď pridáš svoj playlist, nahradí ich.'), '',
    `<button class="btn small-btn primary f" data-act="playlist" data-new="1" data-group="main">${I('plus')}Pridať playlist</button>`) + status;
  const L = LIB;
  const epgTxt = L.epgUpdated ? `Program (EPG) pre ${L.epgMatched || 0} z ${countTxt(CH.length)} · ${ago(L.epgUpdated)}` : epgUrls().length ? 'Program (EPG) sa ešte nenačítal' : 'Bez programu (EPG)';
  const arch = CH.filter(c => c.catchup).length;
  return relayNote + setRow(plCard(L.source.name || 'Môj IPTV', `${countTxt(CH.length)}${arch ? ` · archív na ${arch}` : ''} · aktualizované ${ago(L.updated)}<br>${epgTxt}`), '',
    `<div class="actions"><button class="btn small-btn f" data-act="pl-refresh" data-group="main">${I('hist')}Obnoviť</button><button class="btn small-btn f" data-act="playlist" data-group="main">${I('pencil')}Upraviť</button><button class="btn small-btn f" data-act="pl-remove" data-group="main">${I('trash')}Odstrániť</button></div>`) + status;
}
function setLibStatus(text, busy = false, err = false) {
  S.libStatus = text; S.libBusy = busy; S.libErr = err;
  const el = $('#libStatus');
  if (!el) return;
  el.hidden = !text; el.classList.toggle('busy', busy); el.classList.toggle('err', err);
  $('#libStatusTxt').textContent = text;
}
function rerender() {
  if (P.open) { renderOSD(); return; }
  if (!modal.hidden) return;
  go(S.screen);
}
let importing = false;
async function importPlaylist(src, opts = {}) {
  if (importing) return;
  importing = true;
  setLibStatus('Sťahujem playlist…', true);
  try {
    const res = await library.loadPlaylist(src, pr => setLibStatus(`Sťahujem playlist… ${mb(pr.bytes)}${pr.total ? ' z ' + mb(pr.total) : ''}`, true));
    if (!res.channels.length) throw new Error(res.vodCount ? 'Playlist obsahuje len filmy a seriály (VOD), žiadne živé kanály.' : 'V playliste nie sú žiadne kanály.');
    const same = LIB && LIB.source.m3u === src.m3u && LIB.source.epg === src.epg;
    const L = { source: src, header: res.header, channels: res.channels, vodCount: res.vodCount, updated: Date.now(), epgUpdated: same ? LIB.epgUpdated : 0, epgMatched: same ? LIB.epgMatched : 0 };
    await library.setLibrary(L);
    useLibrary(L, same ? EPG_RAW : null);
    nav.mem = {};
    setLibStatus(`Načítaných ${countTxt(CH.length)}${res.vodCount ? `. ${res.vodCount} filmov a seriálov (VOD) zatiaľ preskakujem` : ''}.`);
    rerender();
    if (!opts.silent) toast(`Playlist načítaný: ${countTxt(CH.length)}`);
    importing = false;
    await refreshEpg();
  } catch (e) {
    setLibStatus('Playlist sa nepodarilo načítať: ' + e.message, false, true);
    if (!opts.silent) toast(e.message);
  }
  importing = false;
}
async function refreshEpg() {
  const urls = epgUrls();
  if (!LIB) return;
  if (!urls.length) { setLibStatus('Playlist neobsahuje adresu programu (EPG). Doplníš ju cez Upraviť.'); return; }
  setLibStatus('Sťahujem program (EPG)…', true);
  try {
    const days = Math.max(1, ...CH.map(c => (c.catchup ? c.catchup.days : 0)));
    const r = await library.loadEpg(urls, CH, { ua: LIB.source.ua, pastDays: Math.min(8, days + 1) },
      pr => setLibStatus(`Spracúvam program (EPG)… ${mb(pr.bytes)}${pr.total ? ' z ' + mb(pr.total) : ''} · ${(pr.programmes || 0).toLocaleString('sk-SK')} relácií`, true));
    EPG_RAW = r.epg; epgCache.clear();
    LIB.epgUpdated = Date.now(); LIB.epgMatched = r.matched;
    await library.setLibrary(LIB);
    setLibStatus(r.matched ? `Program načítaný pre ${r.matched} z ${countTxt(CH.length)}.` : 'EPG sa stiahlo, ale nesedí na žiadny kanál (skontroluj, či patrí k tomuto playlistu).', false, !r.matched);
    rerender();
  } catch (e) {
    setLibStatus('Program (EPG) sa nepodarilo načítať: ' + e.message, false, true);
  }
}

/* ---------- Logos: fall back to the name when an image fails, borrow colours from the ones that load ---------- */
function hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) { const d = max - min; s = l > .5 ? d / (2 - max - min) : d / (max + min); h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; }
  return [h, s, l];
}
const hsl = (h, s, l) => `hsl(${Math.round((h % 360 + 360) % 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
function logoColor(img) {
  try {
    const c = document.createElement('canvas'); c.width = c.height = 24;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0, 24, 24);
    const d = x.getImageData(0, 0, 24, 24).data;
    let r = 0, g = 0, b = 0, w = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      const R = d[i], G = d[i + 1], B = d[i + 2], max = Math.max(R, G, B), min = Math.min(R, G, B);
      if (max < 40) continue;
      const sat = (max - min) / max, wt = sat * sat;
      r += R * wt; g += G * wt; b += B * wt; w += wt;
    }
    if (w < 4) return null;
    const hex = '#' + [r / w, g / w, b / w].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
    const [h, sa] = hexToHsl(hex);
    return [hsl(h, Math.min(.85, sa + .1), .46), hsl(h + 38, Math.min(.9, sa + .1), .56)];
  } catch { return null; }
}
let colorSaveT;
document.addEventListener('load', e => {
  const img = e.target;
  if (img.tagName !== 'IMG' || !img.classList.contains('lg-img')) return;
  const url = img.dataset.logo;
  if (LOGO_COLORS.has(url)) return;
  const col = logoColor(img);
  LOGO_COLORS.set(url, col);
  if (col) {
    CH.forEach(c => { if (c.logoUrl === url) { c.c1 = col[0]; c.c2 = col[1]; } });
    $$(`.lg-img[data-logo="${CSS.escape(url)}"]`).forEach(i => { const host = i.closest('.art, .tile, .bcard'); if (host) { host.style.setProperty('--c1', col[0]); host.style.setProperty('--c2', col[1]); } });
  }
  clearTimeout(colorSaveT);
  colorSaveT = setTimeout(() => store.set('logoColors', Object.fromEntries([...LOGO_COLORS].slice(-6000))), 2000);
}, true);
document.addEventListener('error', e => {
  const img = e.target;
  if (img.tagName !== 'IMG') return;
  if (img.classList.contains('b-blur')) { img.remove(); return; }
  if (!img.classList.contains('lg-img')) return;
  BAD_LOGOS.add(img.dataset.logo);
  const ch = CH.find(c => c.logoUrl === img.dataset.logo);
  const tmp = document.createElement('span');
  tmp.innerHTML = nameLogo(ch ? ch.name : '');
  img.replaceWith(tmp.firstChild);
}, true);

/* ---------- Long lists render in chunks ---------- */
const LAZY = new WeakMap();
function lazyFill(box, items, render, first = 120) {
  box.innerHTML = items.slice(0, first).map(render).join('');
  LAZY.set(box, { items, render, i: Math.min(first, items.length) });
}
function lazyMore(box, n = 120) {
  const L = box && LAZY.get(box);
  if (!L || L.i >= L.items.length) return false;
  box.insertAdjacentHTML('beforeend', L.items.slice(L.i, L.i + n).map(L.render).join(''));
  L.i += n;
  return true;
}
const lazyBoxes = () => [$('#chGrid'), $('#catGrid'), $('#chPanel .plist'), $('#dialog .pick-list'), $('#orgList')];
function lazyNear(sc, box) { if (sc.scrollTop + sc.clientHeight > sc.scrollHeight - 900) lazyMore(box); }

/* ---------- Organizer ---------- */
const ib = (act, id, icon, opt = {}) => `<button class="ibtn f ${opt.cls || ''}" data-act="${act}" data-id="${id}"${opt.list ? ` data-list="${opt.list}"` : ''}${opt.disabled ? ' disabled' : ''} aria-label="${opt.title || ''}" title="${opt.title || ''}">${I(icon)}</button>`;
function orgItem(o, btns) {
  return `<div class="org-item ${S.orgSel === o.id ? 'sel' : ''} ${o.off ? 'off' : ''}"><button class="org-main f" data-act="org-sel" data-id="${o.id}" data-group="main"><span class="sec-ic" style="--sc:${o.color}">${o.icon}</span><span class="o-nm"><b>${esc(o.name)}</b><small>${o.sub}</small></span></button>${btns ? `<span class="org-btns">${btns}</span>` : ''}</div>`;
}
function renderOrgLeftCounts() { const q = $('#orgLeft .org-main[data-id="quick"] small'); if (q) q.textContent = `${S.quick.length} ${plural(S.quick.length, 'kategória', 'kategórie', 'kategórií')}`; }
function renderOrganizer() {
  const L = [`<div class="org-group">Domovská obrazovka</div>`];
  L.push(orgItem({ id: 'quick', icon: I('pin'), color: '#F2B84B', name: 'Tlačidlá na vrchu', sub: `${S.quick.length} ${plural(S.quick.length, 'kategória', 'kategórie', 'kategórií')}` }, ''));
  const n = S.sections.length;
  S.sections.forEach((s, i) => {
    let b = ib('s-up', s.id, 'up', { disabled: i === 0, title: 'Posunúť vyššie' }) + ib('s-down', s.id, 'down', { disabled: i === n - 1, title: 'Posunúť nižšie' })
      + ib('s-eye', s.id, s.show ? 'eye' : 'eye-off', { cls: s.show ? '' : 'off', title: s.show ? 'Skryť na domovskej obrazovke' : 'Zobraziť na domovskej obrazovke' });
    if (s.type !== 'recent') b += ib('s-pin', s.id, 'pin', { cls: S.quick.includes(s.id) ? 'on' : 'off', title: 'Tlačidlo na vrchu' });
    if (s.type === 'cat') b += ib('s-edit', s.id, 'pencil', { title: 'Premenovať, farba a ikona' });
    if (s.custom) b += ib('s-del', s.id, 'trash', { title: 'Zmazať kategóriu' });
    L.push(orgItem({ id: s.id, icon: catIcon(s), color: s.color, name: s.name, sub: (s.show ? '' : 'Skrytá · ') + countTxt(secList(s).length), off: !s.show }, b));
  });
  L.push(`<div class="org-group">Kanály</div>`);
  L.push(orgItem({ id: 'all', icon: I('grid'), color: '#7C8799', name: 'Poradie a čísla kanálov', sub: countTxt(CH.length) }, ''));
  $('#orgLeft').innerHTML = L.join('');
  renderOrgRight();
}
const grabBtn = (list, id, name) => `<button class="grab f" data-act="grab" data-list="${list}" data-id="${id}" draggable="true" aria-label="Presunúť ${esc(name)}" title="Presunúť: OK a potom šípky, alebo potiahni myšou">${I('grip')}</button>`;
function rowBtns(list, id, i, len, removable) {
  return ib('o-up', id, 'up', { list, disabled: i === 0, title: 'Vyššie' }) + ib('o-down', id, 'down', { list, disabled: i === len - 1, title: 'Nižšie' })
    + (removable ? ib('o-rm', id, 'x', { list, title: 'Odobrať' }) : '');
}
function chRow(ch, list, i, len, removable) {
  return `<div class="org-row" data-row="${ch.id}">${list ? grabBtn(list, ch.id, ch.name) : ''}<span class="o-num">${ch.n}</span>${tileStatic(ch, 'mini')}<span class="o-nm"><b>${esc(ch.name)}</b><small>${esc(catName[ch.cat] || '')}</small></span>${list ? `<span class="org-btns">${rowBtns(list, ch.id, i, len, removable)}</span>` : ''}</div>`;
}
const secRow = (s, i, len) => `<div class="org-row" data-row="${s.id}">${grabBtn('quick', s.id, s.name)}<span class="sec-ic" style="--sc:${s.color}">${catIcon(s)}</span><span class="o-nm"><b>${esc(s.name)}</b><small>${countTxt(secList(s).length)}</small></span><span class="org-btns">${rowBtns('quick', s.id, i, len, true)}</span></div>`;
function renderOrgRight() {
  const sel = S.orgSel;
  let title, sub, action = '', items = [], render = null, empty = '';
  const addBtn = (list, txt) => `<button class="btn small-btn f" data-act="o-add" data-list="${list}" data-group="main">${I('plus')}${txt}</button>`;
  const hint = '<br>Presúvanie: OK na úchyte ⋮⋮ a potom šípky (PgUp/PgDn o 10, číslo = pozícia), alebo potiahni myšou.';
  if (sel === 'all') {
    title = 'Poradie a čísla kanálov'; sub = 'Poradie určuje čísla, ktoré zadávaš na ovládači, a prepínanie CH+ a CH−.' + hint;
    items = S.order; render = id => chRow(byId[id], 'all', S.order.indexOf(id), S.order.length, false);
  } else if (sel === 'quick') {
    title = 'Tlačidlá na vrchu'; sub = 'Veľké tlačidlá na domovskej obrazovke. Otvoria celú kategóriu.' + hint;
    action = addBtn('quick', 'Pridať kategóriu');
    items = S.quick.filter(id => secById(id)); render = id => secRow(secById(id), S.quick.indexOf(id), S.quick.length);
    empty = 'Žiadne tlačidlá. Pridaj kategóriu.';
  } else {
    const s = secById(sel);
    if (!s) { S.orgSel = 'quick'; renderOrgRight(); return; }
    title = s.name;
    if (s.type === 'recent') {
      sub = 'Plní sa automaticky podľa toho, čo pozeráš.';
      action = `<button class="btn small-btn f" data-act="clear-recent" data-group="main">${I('trash')}Vymazať históriu</button>`;
      items = secList(s).map(c => c.id); render = id => chRow(byId[id], null);
      empty = 'História je prázdna.';
    } else {
      sub = (s.type === 'fav' ? 'Tvoje obľúbené kanály. Na domovskej obrazovke sú ako veľké karty úplne hore.' : s.custom ? 'Vlastná kategória.' : 'Kategória z playlistu.') + ' Poradie platí len v tejto sekcii.' + hint;
      action = addBtn(s.id, 'Pridať kanály');
      items = s.chs; render = id => chRow(byId[id], s.id, s.chs.indexOf(id), s.chs.length, true);
      empty = 'Sekcia je prázdna. Pridaj do nej kanály.';
    }
  }
  $('#orgRight').innerHTML = `<div class="pane-head"><div><h3>${esc(title)}</h3><p class="muted">${sub}</p></div>${action}</div><div class="org-list" id="orgList"></div>`;
  const box = $('#orgList');
  if (items.length) lazyFill(box, items, render, 80); else box.innerHTML = `<p class="sec-empty">${empty}</p>`;
}
/* Moving an item: OK on its handle starts, arrows move it (PgUp/PgDn by 10, digits jump to a position), OK or Back ends. */
let GRAB = null, DRAG = null, grabSaveT;
function startGrab(el) {
  endGrab();
  GRAB = { list: el.dataset.list, id: el.dataset.id, digits: '' };
  el.closest('.org-row').classList.add('grabbing');
  toast('Presúvaš: šípky ↑ ↓, PgUp/PgDn o 10, číslo = pozícia, OK hotovo');
}
function endGrab() {
  if (!GRAB) return;
  $$('.org-row.grabbing').forEach(r => r.classList.remove('grabbing'));
  GRAB = null;
  clearTimeout(grabSaveT); save();
}
function grabTo(j) {
  const g = GRAB, arr = listRef(g.list), i = arr.indexOf(g.id);
  j = Math.max(0, Math.min(arr.length - 1, j));
  if (i < 0 || i === j) return;
  arr.splice(i, 1); arr.splice(j, 0, g.id);
  if (g.list === 'all') renumber();
  const box = $('#orgList'), row = box && $(`.org-row[data-row="${CSS.escape(g.id)}"]`, box);
  if (!row) { renderOrgRight(); return; }
  while (box.children.length <= j && lazyMore(box)) { /* render far enough to place the row */ }
  row.remove();
  box.insertBefore(row, box.children[j] || null);
  const lo = Math.min(i, j), hi = Math.max(i, j), kids = box.children;
  const touch = new Set([0, arr.length - 1]);
  for (let k = Math.max(0, lo - 1); k <= Math.min(kids.length - 1, hi + 1); k++) touch.add(k);
  for (const k of touch) {
    const r = kids[k]; if (!r || !r.dataset.row) continue;
    const id = r.dataset.row, ix = arr.indexOf(id);
    if (g.list === 'all') { const num = $('.o-num', r); if (num) num.textContent = byId[id].n; }
    const up = $('[data-act="o-up"]', r), dn = $('[data-act="o-down"]', r);
    if (up) up.disabled = ix === 0;
    if (dn) dn.disabled = ix === arr.length - 1;
  }
  const h = $('.grab', row); nav.cur = null; setFocus(h);
  clearTimeout(grabSaveT); grabSaveT = setTimeout(save, 800);
}
function grabKey(k) {
  const arr = listRef(GRAB.list), i = arr.indexOf(GRAB.id);
  if (/^\d$/.test(k)) { GRAB.digits = (GRAB.digits + k).slice(-5); toast(`Presunúť na pozíciu ${GRAB.digits} (OK potvrdí)`); return; }
  if (k === 'up') grabTo(i - 1);
  else if (k === 'down') grabTo(i + 1);
  else if (k === 'chup') grabTo(i - 10);
  else if (k === 'chdown') grabTo(i + 10);
  else if (k === 'ok') { if (GRAB.digits) grabTo(+GRAB.digits - 1); endGrab(); toast('Poradie uložené'); }
  else if (k === 'back' || k === 'bksp') { endGrab(); toast('Poradie uložené'); }
}
const listRef = list => list === 'all' ? S.order : list === 'quick' ? S.quick : (secById(list) || { chs: [] }).chs;
function refocusOrg(el, fallbackSel) {
  let t = twin(el);
  if (t && t.disabled) {
    const alt = { 'o-up': 'o-down', 'o-down': 'o-up', 's-up': 's-down', 's-down': 's-up' }[el.dataset.act];
    t = $(`[data-act="${alt}"][data-id="${CSS.escape(el.dataset.id)}"]${el.dataset.list ? `[data-list="${CSS.escape(el.dataset.list)}"]` : ''}`);
  }
  nav.cur = null;
  setFocus((t && !t.disabled && t) || (fallbackSel && $(fallbackSel)) || pickDefault());
}
function openPicker(list) {
  PK = list;
  const items = list === 'quick'
    ? S.sections.filter(s => s.type !== 'recent').map(s => ({ id: s.id, name: s.name, html: `<span class="sec-ic" style="--sc:${s.color}">${catIcon(s)}</span><span class="o-nm"><b>${esc(s.name)}</b><small>${countTxt(secList(s).length)}</small></span>` }))
    : ordered().map(c => ({ id: c.id, name: c.name + ' ' + (catName[c.cat] || ''), html: `${tileStatic(c, 'mini')}<span class="o-nm"><b>${c.n} · ${esc(c.name)}</b><small>${esc(catName[c.cat] || '')}</small></span>` }));
  const title = list === 'quick' ? 'Tlačidlá na vrchu' : `Kanály v sekcii ${esc(secById(list).name)}`;
  openModal(`<h2>${title}</h2><p class="muted">OK pridá alebo odoberie. Nové položky sa pridajú na koniec.</p>
    ${items.length > 12 ? `<label class="search-box small"><svg class="ic"><use href="#i-search"/></svg><input id="pickQ" class="f" type="search" placeholder="Hľadať podľa názvu alebo skupiny" autocomplete="off" aria-label="Hľadať"></label>` : ''}
    <div class="pick-list"></div>
    <div class="actions"><button class="btn primary f" data-act="pick-done">Hotovo</button></div>`);
  const pl = $('#dialog .pick-list');
  const render = it => `<button class="pick f ${listRef(list).includes(it.id) ? 'on' : ''}" data-act="pick" data-id="${it.id}"><span class="chk">${I('check')}</span>${it.html}</button>`;
  const fill = () => {
    const q = norm(($('#pickQ') || { value: '' }).value.trim());
    const arr = q ? items.filter(it => norm(it.name).includes(q)) : items;
    if (arr.length) lazyFill(pl, arr, render); else pl.innerHTML = `<p class="opt-note">Nič sa nenašlo.</p>`;
  };
  fill();
  let t;
  $('#pickQ')?.addEventListener('input', () => { clearTimeout(t); t = setTimeout(fill, 150); });
  pl.addEventListener('scroll', () => lazyNear(pl, pl), { passive: true });
  nav.cur = null; setFocus($('.pick', pl) || $('#dialog .f'));
}
/** Which sections a single channel belongs to (opened from the channel menu). */
function openMemberPicker(id) {
  const ch = byId[id]; if (!ch) return;
  PK = { member: id };
  const secs = S.sections.filter(s => s.type === 'fav' || s.type === 'cat');
  openModal(`<h2>Zaradiť do kategórií</h2><p class="muted">${esc(ch.name)} · OK pridá alebo odoberie. Novú kategóriu vytvoríš v Nastaveniach → Sekcie a kanály.</p>
    <div class="pick-list">${secs.map(s => `<button class="pick f ${s.chs.includes(id) ? 'on' : ''}" data-act="mpick" data-id="${s.id}"><span class="chk">${I('check')}</span><span class="sec-ic" style="--sc:${s.color}">${catIcon(s)}</span><span class="o-nm"><b>${esc(s.name)}</b><small>${countTxt(s.chs.length)}</small></span></button>`).join('')}</div>
    <div class="actions"><button class="btn primary f" data-act="pick-done">Hotovo</button></div>`);
}
/** Long OK, right click or the menu key on a channel. */
function openChannelMenu(id) {
  const ch = byId[id]; if (!ch) return;
  const now = Date.now(), p = progAt(id, now), fav = isFav(id);
  const arch = !p.none && hasArchive(ch, p.start);
  openModal(`<div class="cm-head">${tileStatic(ch, 'mini')}<div><h2>${esc(ch.name)}</h2><p class="muted">${p.none ? esc(catName[ch.cat] || '') : `Teraz: ${esc(p.title)} · ${hm(p.start)} – ${hm(p.end)}`}</p></div></div>
    <div class="menu-list">
      <button class="mitem f" data-act="m-play" data-ch="${id}">${I('play')}Pozerať naživo</button>
      ${arch ? `<button class="mitem f" data-act="m-restart" data-ch="${id}">${I('restart')}Pozerať od začiatku</button>` : ''}
      <button class="mitem f" data-act="m-fav" data-ch="${id}">${I(fav ? 'heart-f' : 'heart')}${fav ? 'Odobrať z obľúbených' : 'Pridať do obľúbených'}</button>
      <button class="mitem f" data-act="m-cats" data-ch="${id}">${I('grid')}Zaradiť do kategórií…</button>
      ${canRecord() && byId[id].url ? `<button class="mitem f" data-act="m-rec" data-ch="${id}">${I('rec')}${p.none ? 'Nahrávať hodinu' : 'Nahrať reláciu do konca'}</button>` : ''}
      <button class="mitem f" data-act="m-lock" data-ch="${id}">${I(LOCK.chans.includes(id) ? 'unlock' : 'lock')}${LOCK.chans.includes(id) ? 'Odomknúť kanál' : 'Zamknúť kanál (PIN)'}</button>
    </div>
    <div class="actions"><button class="btn f" data-act="close-modal">Zavrieť</button></div>`);
}
let PK = null, CM = null;
function openCatModal(id) {
  const s = id ? secById(id) : null;
  CM = { id, color: s ? s.color : PALETTE[S.sections.length % PALETTE.length], icon: s ? s.icon : 'auto', pin: s ? S.quick.includes(s.id) : false };
  openModal(`<h2>${s ? 'Upraviť kategóriu' : 'Nová kategória'}</h2>
    <div class="field"><label for="cmName">Názov</label><input id="cmName" class="f" value="${s ? esc(s.name) : ''}" placeholder="Napríklad Večerné filmy" autocomplete="off"></div>
    <div class="field"><span class="flabel">Farba</span><div class="swatches">${PALETTE.map(c => `<button class="swatch f ${CM.color === c ? 'on' : ''}" style="--sw:${c}" data-act="cm-color" data-v="${c}" aria-label="Farba ${c}"></button>`).join('')}</div></div>
    <div class="field"><span class="flabel">Ikona</span><div class="icopts">${ICONS.map(ic => `<button class="icopt f ${CM.icon === ic ? 'on' : ''}" data-act="cm-icon" data-v="${ic}" aria-label="${ic === 'auto' ? 'Iniciály' : ic}">${ic === 'auto' ? '<span class="txt-ic">Aa</span>' : I(ic)}</button>`).join('')}</div></div>
    ${setRow('Tlačidlo na vrchu domovskej obrazovky', '', `<button class="toggle f ${CM.pin ? 'on' : ''}" data-act="cm-pin" aria-label="Tlačidlo na vrchu"></button>`)}
    <div class="actions"><button class="btn f" data-act="close-modal">Zrušiť</button><button class="btn primary f" data-act="cm-save">${s ? 'Uložiť' : 'Vytvoriť a vybrať kanály'}</button></div>`);
}

/* ---------- Favorites, recent, reminders ---------- */
function toggleFav(id) {
  const f = secById('fav'); if (!id || !f) return;
  const ch = byId[id], i = f.chs.indexOf(id);
  if (i >= 0) { f.chs.splice(i, 1); toast(`${ch.name} odobratý z obľúbených`); }
  else { f.chs.push(id); toast(`${ch.name} pridaný do obľúbených`); }
  save();
  if (P.open) renderOSD();
  else if (S.screen === 'home') renderHome();
  else if (S.screen === 'channels') renderChannels();
}
function pushRecent(id) { S.recent = [id, ...S.recent.filter(x => x !== id)].slice(0, 16); store.set('recent:' + S.libKey, S.recent); }
function progAction(id, start) {
  const p = findProg(id, start);
  const now = Date.now();
  if (p.none || (p.start <= now && p.end > now)) { openOrTune(id, 0); return 'play'; }
  if (p.end <= now) {
    if (!hasArchive(byId[id], p.start)) { openOrTune(id, 0); toast('Tento kanál nemá archív, púšťam živé vysielanie'); return 'play'; }
    openOrTune(id, (now - p.start) / 1000); toast(`Z archívu: ${p.title}`); return 'play';
  }
  const k = id + ':' + start;
  if (canRecord() && byId[id].url) { openFutureMenu(id, start); return 'menu'; }
  if (S.rem.has(k)) { S.rem.delete(k); toast('Pripomienka zrušená'); }
  else { S.rem.add(k); toast(`Pripomeniem: ${p.title} o ${hm(p.start)}`); }
  store.set('rem:' + S.libKey, [...S.rem]);
  if (P.open && P.panel === 'prog') { renderSheet('prog'); setFocus($(`#sheet [data-start="${start}"]`)); }
  else if (S.screen === 'guide') { renderGuide(true); const el = $(`#gScroll [data-ch="${id}"][data-start="${start}"]`); nav.cur = null; setFocus(el, { noScroll: true }); }
  return 'rem';
}

/* ---------- Player ---------- */
const P = { open: false, ch: null, last: null, offset: 0, paused: false, osd: false, panel: null, panelFrom: null,
  audio: S.set.lang, subs: S.set.subs, quality: 'auto', aspect: 'fit', hideT: 0, bannerT: 0, num: '', numT: 0, tileCh: null, appFocus: null,
  real: false, mode: 'live', archStart: 0, base: null, kinds: {}, prefApplied: false, error: false };
// Two players for the two-picture mode. `engine` is always the active one (sound, controls, zapping);
// the other only runs while two pictures are on.
const mkEngine = (el, me) => new Engine(el, {
  onState: (s, i) => { if (me() === engine) engineState(s, i); else paneLabels(); },
  onTracks: () => { if (me() !== engine) return; applyPrefs(); if (P.panel === 'audio') refreshSheet(); if (P.osd) renderOSD(); },
  onKind: k => { const id = me() === engine ? P.ch : M.ch; if (id) P.kinds[id] = k; },
  onReconnect: () => { if (me() === engine && P.mode === 'live') P.base = null; },
  onMuted: () => { if (me() === engine) toast('Prehliadač spustil video bez zvuku. Zvuk zapneš kliknutím do obrazu.'); },
});
const E1 = mkEngine($('#vid'), () => E1), E2 = mkEngine($('#vid2'), () => E2);
let engine = E1;
E1.v.classList.add('active');
const maxOffset = () => { const ch = byId[P.ch]; return ch && ch.catchup ? ch.catchup.days * 86400 : 4 * 3600; };
const isLive = () => P.offset < 3 && !P.paused && P.mode === 'live';
function openOrTune(id, offset = 0) {
  if (!P.open) return openPlayer(id, offset);
  if (P.mini) exitMini();
  tune(id, offset);
}
function openPlayer(id, offset = 0) {
  if (isLocked(id)) return askPin(() => { UNLOCKED = true; openPlayer(id, offset); });
  P.appFocus = nav.cur; clearFocus();
  P.open = true; player.hidden = false;
  document.body.classList.add('playing');
  tune(id, offset);
  cancelAnimationFrame(vid.raf); vid.last = 0; vid.raf = requestAnimationFrame(frame);
}
function closePlayer() {
  if (M.on) endMulti();
  if (engine === E2) { engine.close(); E2.v.classList.remove('active'); engine = E1; E1.v.classList.add('active'); player.classList.remove('solo2'); applyVolume(); }
  if (P.mini) { P.mini = false; P.appFocus = null; setMiniUI(false); if (nav.cur && $('#miniBar').contains(nav.cur)) clearFocus(); }
  closePanel(true); hideOSD(); hideBanner(); hideStatus();
  engine.close();
  P.open = false; player.hidden = true; cancelAnimationFrame(vid.raf);
  document.body.classList.remove('playing');
  if (document.fullscreenElement && !IS_TV) document.exitFullscreen().catch(() => {});
  const back = P.appFocus;
  if (S.screen === 'home') renderHome(back);
  if (!nav.cur) { const t = twin(back); setFocus(t && visible(t) ? t : pickDefault()); }
}
/* Mini player: the picture shrinks into a corner and keeps playing while the rest of the app is used. */
function setMiniUI(on) {
  document.body.classList.toggle('mini', on);
  player.classList.toggle('mini', on);
  $('#miniBar').hidden = !on;
  if (on) $('#miniNative').hidden = !(document.pictureInPictureEnabled && P.real);
}
function enterMini() {
  if (!P.open || P.mini) return;
  if (M.on) endMulti();
  closePanel(true); hideOSD(); hideBanner();
  if (document.fullscreenElement && !IS_TV) document.exitFullscreen().catch(() => {});
  P.mini = true;
  document.body.classList.remove('playing');
  setMiniUI(true); renderMini();
  const back = P.appFocus;
  if (S.screen === 'home') renderHome(back);
  const t = twin(back); setFocus(t && visible(t) ? t : pickDefault());
  toast(IS_TV ? 'Malé okienko · späť na celú obrazovku červeným tlačidlom' : 'Malé okienko · späť kliknutím alebo klávesom P');
}
function exitMini() {
  if (!P.mini) return;
  P.mini = false; setMiniUI(false);
  P.appFocus = nav.cur; clearFocus();
  document.body.classList.add('playing');
  if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
  showBanner();
}
function renderMini() { if (P.mini && byId[P.ch]) $('#miniName').textContent = byId[P.ch].name; }
async function nativePip() {
  try { await engine.v.requestPictureInPicture(); } catch { toast('Prehliadač tu okno nad ostatnými aplikáciami nepovolil'); }
}
const srcFor = (ch, extra) => ({ url: ch.url, ua: ch.ua || (LIB && LIB.source.ua) || '', ref: ch.ref || '', ...extra });
function startLive(ch) {
  P.rec = null;
  P.mode = 'live'; P.offset = 0; P.base = null; P.paused = false; P.prefApplied = false;
  engine.open(srcFor(ch, { live: true, kind: P.kinds[ch.id] }));
}
function startArchive(ch, atMs) {
  const now = Date.now();
  const url = catchupUrl(ch, atMs, now, now);
  if (!url) { toast('Pre tento kanál sa archív nedá spustiť.'); return false; }
  P.rec = null;
  P.mode = 'archive'; P.archStart = atMs; P.offset = (now - atMs) / 1000; P.paused = false; P.prefApplied = false;
  engine.open(srcFor(ch, { url, live: false }));
  return true;
}
function tune(id, offset = 0) {
  if (isLocked(id)) return askPin(() => { UNLOCKED = true; tune(id, offset); });
  if (P.ch && P.ch !== id) P.last = P.ch;
  const ch = byId[id];
  P.ch = id; P.paused = false; P.real = !!ch.url;
  player.classList.toggle('real', P.real);
  pushRecent(id);
  hideStatus();
  $('#dog').innerHTML = P.real ? '' : logoHTML(ch);
  if (P.real) {
    const at = Date.now() - offset * 1000;
    if (!(offset > 3 && hasArchive(ch, at) && startArchive(ch, at))) startLive(ch);
  } else {
    engine.close();
    P.mode = 'live'; P.offset = Math.min(offset, maxOffset());
    vid.noise = performance.now() + 320; vid.frozen = false;
  }
  renderOSD(); renderSubs(true); renderMini(); paneLabels();
  if (!P.osd && !P.panel && !P.mini) showBanner();
}
function step(d) {
  const o = S.order, i = o.indexOf(P.ch);
  // Zapping skips locked channels; they open only when picked directly (with the PIN).
  let j = i;
  for (let n = 0; n < o.length; n++) { j = (j + d + o.length) % o.length; if (!isLocked(o[j])) break; }
  tune(o[j]);
  if (P.panel === 'prog') { renderSheet('prog'); setFocus($('#sheet .pr.now') || $('#sheet .f')); }
}
function togglePause() {
  P.paused = !P.paused;
  if (P.real) { if (P.paused) engine.pause(); else engine.resume(); }
  else vid.frozen = false;
  player.classList.toggle('paused', P.paused);
  renderOSD();
  if (P.osd) armHide();
  toast(P.paused ? 'Pozastavené · vysielanie sa ukladá do časového posunu' : (isLive() ? 'Naživo' : `Pokračuje s posunom −${durTxt(P.offset)}`));
}
/** Real streams: move within the local buffer when possible, otherwise switch to the provider's archive. */
function seekReal(delta) {
  const ch = byId[P.ch], now = Date.now();
  const target = Math.max(0, P.offset - delta);
  if (P.mode === 'live') {
    if (delta > 0 || engine.canBack(-delta)) { engine.seekBy(delta); return; }
    if (hasArchive(ch, now - target * 1000) && startArchive(ch, now - target * 1000)) return;
    engine.seekBy(delta);
    toast(ch.catchup ? 'Ďalej dozadu archív nesiaha.' : 'Tento kanál nemá archív. Dozadu sa dá len v rámci vyrovnávacej pamäte.');
    return;
  }
  const v = engine.v, pos = v.currentTime + delta;
  if (P.rec) { v.currentTime = Math.max(0, Math.min(pos, engine.playableEnd() - 1)); return; }
  if (target < 10) { startLive(ch); toast('Naživo'); return; }
  if (pos >= 0 && pos <= engine.playableEnd() - 1) { v.currentTime = pos; return; }
  if (hasArchive(ch, now - target * 1000)) startArchive(ch, now - target * 1000);
}
function seek(delta) {
  if (P.real) seekReal(delta);
  else {
    P.offset = Math.max(0, Math.min(maxOffset(), P.offset - delta));
    if (P.offset < 3 && !P.paused) P.offset = 0;
    vid.noise = performance.now() + 90;
  }
  renderOSD();
  if (!P.osd && !P.panel) showOSD('#seek');
  armHide();
}
function toLive() {
  P.paused = false; player.classList.remove('paused');
  if (P.real) startLive(byId[P.ch]); else P.offset = 0;
  renderOSD(); toast('Naživo');
}
function restartProg() {
  const ch = byId[P.ch], now = Date.now(), p = progAt(P.ch, now - P.offset * 1000);
  if (p.none) { toast('Program tohto kanála nie je známy.'); return; }
  if (!P.real) { P.offset = (now - p.start) / 1000; renderOSD(); toast(`Od začiatku: ${p.title}`); return; }
  if (hasArchive(ch, p.start) && startArchive(ch, p.start)) { toast(`Od začiatku: ${p.title}`); return; }
  engine.seekBy(-(engine.v.currentTime - engine.earliest()));
  toast('Tento kanál nemá archív. Posúvam na začiatok vyrovnávacej pamäte.');
}
/** Keep P.offset (seconds behind real time) in sync with what the video element actually shows. */
function syncOffset() {
  if (!P.real) return;
  if (P.mode === 'live') {
    const b = engine.behind();
    if (b == null || engine.state === 'loading' || engine.state === 'reconnecting') return;
    if (P.base == null) { if (engine.state === 'playing') P.base = b; return; }
    if (b < P.base) P.base = b;
    P.offset = Math.max(0, b - P.base);
  } else {
    P.offset = Math.max(0, (Date.now() - (P.archStart + engine.v.currentTime * 1000)) / 1000);
  }
}
function applyPrefs() {
  if (!P.real || P.prefApplied) return;
  const t = engine.tracks();
  if (!t.audio.length && !t.text.length) return;
  P.prefApplied = true;
  const a = t.audio.find(x => langMatches(x.lang, S.set.lang));
  if (a && !a.on) engine.setAudio(a.id);
  if (S.set.subs !== 'off') { const x = t.text.find(x => langMatches(x.lang, S.set.subs)); if (x) engine.setText(x.id); }
}
let statusT;
function engineState(state, info) {
  if (!P.open || !P.real) return;
  clearTimeout(statusT);
  if (state === 'playing' || state === 'idle') { hideStatus(); if (P.osd) renderOSD(); return; }
  if (state === 'loading' || state === 'buffering') {
    statusT = setTimeout(() => showStatus('spin', state === 'loading' ? 'Načítavam kanál…' : ''), state === 'loading' ? 350 : 800);
    return;
  }
  if (state === 'reconnecting') {
    showStatus('spin', info.reason === 'codec' ? (info.level === 'video' ? 'Prehliadač nepozná obraz tohto kanála, prekladám ho…' : 'Prehliadač nepozná zvuk tohto kanála, prekladám ho…') : 'Obnovujem spojenie…',
      info.reason === 'codec' && info.level === 'video' ? 'Prevod obrazu zaťaží procesor tohto PC. Na TV nebude potrebný.' : info.attempt > 1 ? `Pokus ${info.attempt}` : '');
    return;
  }
  if (state === 'error') {
    showStatus('error', 'Kanál sa nedá prehrať', errorText(info));
    if (info.type === 'codec') describeCodecs();
  }
}
/** After a codec failure, ask ffprobe what the stream contains and say it in plain words. */
async function describeCodecs() {
  const ch = byId[P.ch]; if (!ch) return;
  const want = P.ch;
  const streams = await streamInfo(engine.src?.url || ch.url, srcFor(ch, {}));
  if (P.ch !== want || !P.error || !streams.length) return;
  const NAMES = { hevc: 'HEVC (H.265)', h264: 'H.264', mpeg2video: 'MPEG-2', av1: 'AV1', vp9: 'VP9', ac3: 'AC-3', eac3: 'E-AC-3', mp2: 'MP2', aac: 'AAC', mp3: 'MP3', dts: 'DTS' };
  const v = streams.find(x => x.codec_type === 'video'), a = streams.filter(x => x.codec_type === 'audio');
  const parts = [];
  if (v) parts.push(`obraz ${NAMES[v.codec_name] || v.codec_name}${v.profile ? ' ' + v.profile : ''}${v.width ? `, ${v.width}×${v.height}` : ''}${/10/.test(v.pix_fmt || '') ? ', 10-bit' : ''}${v.field_order && v.field_order !== 'progressive' ? ', prekladaný (interlaced)' : ''}`);
  if (a.length) parts.push(`zvuk ${[...new Set(a.map(x => NAMES[x.codec_name] || x.codec_name))].join(', ')}`);
  $('#pStatusSub').textContent = `${$('#pStatusSub').textContent} Kanál má: ${parts.join(' · ')}.`;
}
function errorText(info) {
  if (info.type === 'codec') return relayHasFfmpeg() ? 'Tento prehliadač nevie prehrať tento kanál ani po prevode cez ffmpeg.'
    : 'Prehliadač nevie prehrať zvuk alebo obraz tohto kanála, najčastejšie zvuk AC3. Pomôže nainštalovať ffmpeg na tomto PC (pozri README), na TV to nevadí.';
  if (info.type === 'network') {
    const code = +((/\b([45]\d\d)\b/.exec(info.detail || '') || [])[1] || 0);
    if (code === 401 || code === 403 || code === 458 || code === 509 || code === 429)
      return `Poskytovateľ odmietol pripojenie (kód ${code}). Najčastejšie preto, že ten istý účet práve pozerá iné zariadenie alebo program (napríklad VLC) a predplatné dovoľuje len jedno pripojenie naraz. Zavri ho a skús znova.`;
    if (code === 404) return 'Poskytovateľ tento kanál nenašiel (kód 404). Možno sa zmenil playlist, skús ho v Nastaveniach obnoviť.';
    if (code >= 500) return `Server poskytovateľa má problém (kód ${code}). Skús to o chvíľu.`;
    return 'Server poskytovateľa neodpovedá alebo kanál práve nevysiela. Ak kanál ide vo VLC, zavri VLC (predplatné môže dovoliť len jedno pripojenie) a skús znova.';
  }
  if (info.type === 'stall') return 'Obraz sa zastavil a spojenie sa nepodarilo obnoviť.';
  return info.detail || 'Neznáma chyba prehrávania.';
}
function showStatus(kind, title, sub = '') {
  const st = $('#pStatus');
  st.hidden = false; st.className = 'p-status is-' + kind;
  $('#pStatusTxt').textContent = title; $('#pStatusSub').textContent = sub;
  $('#pRetry').hidden = kind !== 'error';
  P.error = kind === 'error';
  if (P.error && !P.osd && !P.panel) setFocus($('#pRetry'));
}
function hideStatus() {
  clearTimeout(statusT);
  $('#pStatus').hidden = true;
  if (P.error && nav.cur && nav.cur.id === 'pRetry') clearFocus();
  P.error = false;
}
const KIND_NAME = { hls: 'HLS', ts: 'MPEG-TS', file: 'súbor', unknown: 'neznámy' };
function trackSummary() {
  if (!P.real) return { audio: label(AUDIO, P.audio), text: label(SUBS, P.subs).toLowerCase(), quality: P.quality !== 'auto' ? label(QUAL, P.quality) : '' };
  const t = engine.tracks();
  const a = t.audio.find(x => x.on), x = t.text.find(y => y.on);
  return { audio: a ? a.label : 'predvolený', text: x ? x.label : 'vypnuté', quality: t.info.h ? `${t.info.h}p` : '' };
}

function renderOSD() {
  const ch = byId[P.ch]; if (!ch) return;
  player.classList.toggle('paused', P.paused);
  const now = Date.now(), pos = now - P.offset * 1000;
  let p = progAt(ch.id, pos);
  const nx = progNext(ch.id, p);
  if (p.none) { const span = Math.max(1800, P.offset + 300) * 1000; p = { ...p, start: now - span, end: now + 60e3 }; }
  if (P.tileCh !== ch.id) { $('#oTile').innerHTML = tileStatic(ch, 'mini'); P.tileCh = ch.id; }
  $('#oName').textContent = `${ch.n} · ${ch.name}`;
  $('#cRec').hidden = !(canRecord() && P.real && !P.rec);
  $('#cRec').classList.toggle('on', !P.rec && !p.none && !!recFor(ch.id, p.start));
  $('#oStatus').innerHTML = isLive() ? `<span class="badge live"><i class="dot"></i>Živé</span>`
    : P.paused ? `<span class="badge">Pozastavené · −${durTxt(P.offset)}</span>`
    : P.rec ? `<span class="badge arch">${I('rec')}Nahrávka</span>`
    : P.mode === 'archive' ? `<span class="badge arch">${I('hist')}Archív · −${durTxt(P.offset)}</span>`
    : `<span class="badge arch">${I('hist')}Posun −${durTxt(P.offset)}</span>`;
  $('#oClock').textContent = (SLEEP.at ? `⏾ ${sleepLeft()} · ` : '') + hm(now);
  $('#oTitle').textContent = p.none ? ch.name : p.title;
  const tr = trackSummary();
  $('#oMeta').innerHTML = (p.none ? `<span>${esc(catName[ch.cat] || '')}</span><span>Program nie je k dispozícii</span>` : `<span>${hm(p.start)} – ${hm(p.end)}</span>${p.genre ? `<span>${esc(p.genre)}</span>` : ''}`)
    + `<span>Zvuk: ${esc(tr.audio)}</span><span>Titulky: ${esc(tr.text)}</span>${tr.quality ? `<span>${tr.quality}</span>` : ''}`;
  const lf = frac(p, now), pf = frac(p, pos);
  $('#sBuf').style.width = lf * 100 + '%';
  $('#sPlayed').style.width = pf * 100 + '%';
  $('#sHead').style.left = pf * 100 + '%';
  $('#sStart').textContent = hm(p.start);
  $('#sEnd').textContent = hm(p.end);
  $('#sPos').textContent = isLive() ? 'Naživo' : `${hms(pos)} · −${durTxt(P.offset)}`;
  const play = $('#cPlay');
  $('use', play).setAttribute('href', P.paused ? '#i-play' : '#i-pause');
  $('.tip', play).textContent = P.paused ? 'Prehrať' : 'Pauza';
  $('#cLive').classList.toggle('is-live', isLive());
  const fav = $('#cFav'), on = isFav(ch.id);
  $('use', fav).setAttribute('href', on ? '#i-heart-f' : '#i-heart');
  fav.classList.toggle('fav-on', on);
  $('.tip', fav).textContent = on ? 'Odobrať z obľúbených' : 'Pridať do obľúbených';
  $('#oNext').innerHTML = nx ? `Ďalej <b>${hm(nx.start)}</b>${esc(nx.title)}` : '';
}
function showOSD(sel) {
  P.osd = true; player.classList.add('osd-on'); hideBanner();
  renderOSD();
  if (sel) setFocus($(sel, osd));
  else if (!nav.cur || !osd.contains(nav.cur)) setFocus($('#cPlay'));
  armHide();
}
function hideOSD() {
  P.osd = false; player.classList.remove('osd-on'); clearTimeout(P.hideT);
  if (nav.cur && osd.contains(nav.cur)) clearFocus();
}
function armHide() { clearTimeout(P.hideT); if (P.paused || P.panel) return; P.hideT = setTimeout(hideOSD, (+S.set.hide || 5) * 1000); }
function showBanner() {
  const ch = byId[P.ch], now = Date.now(), pos = now - P.offset * 1000, p = progAt(ch.id, pos), nx = progNext(ch.id, p);
  $('#bNum').textContent = ch.n;
  $('#bTile').innerHTML = tileStatic(ch, 'mini');
  $('#bName').textContent = ch.name + (P.mode === 'archive' ? ' · ARCHÍV' : ' · ŽIVÉ');
  $('#bTitle').textContent = p.none ? (catName[ch.cat] || '') : p.title;
  $('#bBar').style.width = (p.none ? 0 : frac(p, now) * 100) + '%';
  $('#bNext').innerHTML = nx ? `<b>${hm(nx.start)}</b>${esc(nx.title)}` : '';
  $('#banner').classList.add('on'); $('#pHint').classList.add('on');
  clearTimeout(P.bannerT); P.bannerT = setTimeout(hideBanner, 3800);
}
function hideBanner() { $('#banner').classList.remove('on'); $('#pHint').classList.remove('on'); clearTimeout(P.bannerT); }

function openPanel(name) {
  P.panelFrom = P.osd ? nav.cur : null;
  hideOSD(); hideBanner();
  P.panel = name;
  if (name === 'list') {
    renderList(); sheet.classList.remove('on'); chPanel.classList.add('on');
    const cur = $(`#chPanel [data-ch="${P.ch}"]`); setFocus(cur, { noScroll: true }); cur.scrollIntoView({ block: 'center' });
  } else {
    renderSheet(name); chPanel.classList.remove('on'); sheet.classList.add('on');
    const f = $('#sheet .opt.on') || $('#sheet .pr.now') || $('#sheet .f'); setFocus(f, { noScroll: true }); if (f) f.scrollIntoView({ block: 'center' });
  }
}
function closePanel(silent) {
  if (!P.panel) return;
  const from = P.panelFrom;
  P.panel = null; P.panelFrom = null; P.pick = null;
  chPanel.classList.remove('on'); sheet.classList.remove('on'); clearFocus();
  if (!silent && from && P.open) { showOSD(); setFocus(from); }
}
const listItem = c => {
  const p = progAt(c.id, Date.now());
  return `<button class="pitem f ${c.id === P.ch ? 'cur' : ''}" data-act="tune" data-ch="${c.id}"><span class="pnum">${c.n}</span>${tileStatic(c, 'mini')}<span class="pinfo"><b>${esc(c.name)}</b><small>${p.none ? esc(catName[c.cat] || '') : esc(p.title)}</small><span class="bar"><i style="width:${p.none ? 0 : frac(p, Date.now()) * 100}%"></i></span></span></button>`;
};
function renderList() {
  const list = ordered(), idx = list.findIndex(c => c.id === P.ch);
  chPanel.innerHTML = `<div class="panel-head"><h3>Kanály</h3><span>${countTxt(CH.length)}</span></div><div class="plist"></div>`;
  const pl = $('.plist', chPanel);
  lazyFill(pl, list, listItem, Math.max(120, idx + 60));
  pl.addEventListener('scroll', () => lazyNear(pl, pl), { passive: true });
}
function realAudioSheet() {
  const t = engine.tracks();
  const opt = (k, id, l, sub, on) => `<button class="opt f ${on ? 'on' : ''}" data-act="eopt" data-k="${k}" data-v="${id}"><span>${esc(l)}${sub ? `<small>${esc(sub)}</small>` : ''}</span>${I('check')}</button>`;
  let h = `<div class="sheet-sec">Zvuková stopa</div>`;
  h += t.audio.length > 1 ? t.audio.map(a => opt('audio', a.id, a.label, a.lang && a.lang.toLowerCase() !== a.label.toLowerCase() ? a.lang.toUpperCase() : '', a.on)).join('')
    : `<p class="opt-note">${t.audio.length ? esc(t.audio[0].label) : 'Jedna zvuková stopa'}${t.info.via === 'mpegts.js' ? '. Ak má kanál viac jazykov, v prehliadači pri MPEG-TS hrá prvý. Na TV sa dajú prepínať.' : ''}</p>`;
  h += `<div class="sheet-sec">Titulky</div>` + opt('text', -1, 'Vypnuté', '', !t.text.some(x => x.on)) + t.text.map(x => opt('text', x.id, x.label, '', x.on)).join('');
  if (!t.text.length) h += `<p class="opt-note">Stream neobsahuje titulky, ktoré vie prehliadač zobraziť.</p>`;
  if (t.quality.length) h += `<div class="sheet-sec">Kvalita</div>` + t.quality.map(q => opt('quality', q.id, q.label, q.sub, q.on)).join('');
  h += `<div class="sheet-sec">Pomer strán</div>` + ASPECT.map(([v, l, sub]) => `<button class="opt f ${P.aspect === v ? 'on' : ''}" data-act="opt" data-k="aspect" data-v="${v}"><span>${l}<small>${sub}</small></span>${I('check')}</button>`).join('');
  const i = t.info;
  h += `<div class="sheet-sec">Technické info</div><p class="opt-note">${KIND_NAME[i.kind] || i.kind || '–'}${i.w ? ` · ${i.w}×${i.h}` : ''} · ${i.via || '–'}${i.remux === 'video' ? ' · obraz aj zvuk prekladané cez ffmpeg' : i.remux ? ' · zvuk prekladaný cez ffmpeg' : ''}${P.mode === 'archive' ? ' · archív' : ''}</p><p class="opt-note">${statsLine()}</p><p class="opt-note">Podrobné štatistiky: kláves D (na TV modré tlačidlo).</p>`;
  return `<div class="panel-head"><h3>Zvuk a titulky</h3></div><div class="plist">${h}</div>`;
}
function statsLine() {
  const s = engine.stats();
  return `Rezerva ${s.ahead.toFixed(1)} s (cieľ ${s.goal.toFixed(1)} s) · zaseknutia ${s.stalls} · zahodené snímky ${s.dropped}/${s.frames}`;
}
let statsT = 0;
function toggleStats(on = $('#pStats').hidden) {
  const el = $('#pStats');
  clearInterval(statsT); statsT = 0;
  el.hidden = !on;
  if (!on) return;
  const draw = () => {
    if (!P.open) return toggleStats(false);
    const i = engine.tracks().info, s = engine.stats(), v = engine.v;
    el.textContent = [
      `prehrávač   ${i.via || '–'} · ${KIND_NAME[i.kind] || i.kind || '–'}${i.remux ? ` · ffmpeg ${i.remux === 'video' ? 'obraz+zvuk' : 'zvuk'}` : ''}`,
      `obraz       ${v.videoWidth ? `${v.videoWidth}×${v.videoHeight}` : '–'}`,
      `rezerva     ${s.ahead.toFixed(1)} s  (cieľ ${s.goal.toFixed(1)} s)`,
      `zaseknutia  ${s.stalls}`,
      `snímky      ${s.dropped} zahodených z ${s.frames}`,
      `stav        ${engine.state}${engine.holding ? ' · napĺňam rezervu' : ''}`,
    ].join('\n');
  };
  draw(); statsT = setInterval(draw, 500);
}
function refreshSheet() {
  const f = nav.cur && sheet.contains(nav.cur) ? nav.cur : null;
  const top = $('.plist', sheet)?.scrollTop || 0;
  renderSheet('audio');
  const pl = $('.plist', sheet); if (pl) pl.scrollTop = top;
  if (f) { nav.cur = null; setFocus(twin(f) || $('#sheet .f'), { noScroll: true }); }
}
/* ---------- Recordings (local server) ---------- */
let RECS = [], recT = 0;
const recFor = (ch, start) => RECS.find(r => r.ch === ch && r.start === start && r.status !== 'failed');
async function refreshRecs() {
  if (!canRecord()) return;
  try { RECS = (await recList()).items || []; } catch { return; }
  clearTimeout(recT);
  const busy = RECS.some(r => r.status === 'processing' || (r.status === 'recording' && r.end <= Date.now()));
  if (busy || RECS.some(r => r.status === 'recording' || r.status === 'scheduled')) recT = setTimeout(refreshRecs, busy ? 2500 : 20000);
  if (S.screen === 'recs' && !P.open) renderRecs(true);
}
function afterProgChange(id, start) {
  if (P.open && P.panel === 'prog') { renderSheet('prog'); setFocus($(`#sheet [data-start="${start}"]`)); }
  else if (S.screen === 'guide') { renderGuide(true); const el = $(`#gScroll [data-ch="${id}"][data-start="${start}"]`); nav.cur = null; setFocus(el, { noScroll: true }); }
  else if (S.screen === 'search') { const el = $(`#results [data-act="rprog"][data-ch="${id}"][data-start="${start}"]`); if (el) { el.outerHTML = progRes(byId[id], findProg(id, start), 'later'); setFocus($(`#results [data-act="rprog"][data-ch="${id}"][data-start="${start}"]`), { noScroll: true }); } }
}
function openFutureMenu(id, start) {
  const ch = byId[id], p = findProg(id, start), rem = S.rem.has(id + ':' + start), r = recFor(id, start);
  openModal(`<div class="cm-head">${tileStatic(ch, 'mini')}<div><h2>${esc(p.title)}</h2><p class="muted">${esc(ch.name)} · ${dayWord(p.start)} ${hm(p.start)} – ${hm(p.end)}</p></div></div>
    <div class="menu-list">
      ${rem ? `<button class="mitem f" data-act="f-unrem" data-ch="${id}" data-start="${start}">${I('bell')}Zrušiť pripomienku</button>` : `<button class="mitem f" data-act="f-rem" data-ch="${id}" data-start="${start}">${I('bell')}Pripomenúť</button>`}
      ${r ? `<button class="mitem f" data-act="f-unrec" data-id="${r.id}">${I('x')}Zrušiť nahrávanie</button>` : canRecord() && ch.url ? `<button class="mitem f" data-act="f-rec" data-ch="${id}" data-start="${start}">${I('rec')}Nahrať</button>` : ''}
    </div>
    <div class="actions"><button class="btn f" data-act="close-modal">Zavrieť</button></div>`);
}
async function scheduleRec(ch, title, start, end) {
  try {
    await recAdd({ ch: ch.id, chName: ch.name, title, url: ch.url, ua: ch.ua || (LIB && LIB.source.ua) || '', ref: ch.ref || '', start, end });
    toast(start <= Date.now() ? `Nahrávam: ${title}` : `Nahrám: ${title} · ${dayWord(start)} ${hm(start)}`);
    $('#navRecs').hidden = false;
    await refreshRecs();
  } catch (e) { toast('Nahrávanie sa nepodarilo: ' + e.message); }
}
function recordNow(id) {
  const ch = byId[id]; if (!ch || !ch.url) return;
  const now = Date.now(), p = progAt(id, now);
  if (!p.none && recFor(id, p.start)) { toast('Táto relácia sa už nahráva'); return; }
  scheduleRec(ch, p.none ? ch.name : p.title, p.none ? now : p.start, p.none ? now + 3600e3 : p.end);
}
async function removeRec(r) {
  const done = r.status === 'done';
  try { await recDelete(r.id); toast(done ? 'Nahrávka zmazaná' : r.status === 'recording' ? 'Nahrávanie zrušené a zmazané' : 'Nahrávanie zrušené'); } catch (e) { toast(e.message); }
  await refreshRecs();
  if (S.screen === 'guide') renderGuide(true);
}
const REC_ST = { recording: 'Nahráva sa', scheduled: 'Naplánované', processing: 'Spracúva sa', done: 'Hotové', failed: 'Nepodarilo sa' };
function renderRecs(keep) {
  const box = $('#recList');
  const focusKey = keep && nav.cur && box.contains(nav.cur) ? [nav.cur.dataset.act, nav.cur.dataset.id] : null;
  if (!canRecord()) { box.innerHTML = `<p class="empty">Nahrávanie funguje cez lokálny server s ffmpeg (npm start na PC).</p>`; return; }
  const order = ['recording', 'processing', 'scheduled', 'done', 'failed'];
  const groups = order.map(st => [st, RECS.filter(r => r.status === st).sort((a, b) => st === 'scheduled' ? a.start - b.start : b.start - a.start)]).filter(g => g[1].length);
  const used = RECS.filter(r => r.status === 'done').reduce((a, r) => a + r.size, 0);
  $('#recSub').textContent = RECS.length ? `${RECS.filter(r => r.status === 'done').length} hotových · ${mb(used)}` : '';
  box.innerHTML = groups.length ? groups.map(([st, list]) => `<h4>${REC_ST[st]}</h4>` + list.map(r => {
    const ch = byId[r.ch];
    const when = `${dayWord(r.start)} ${hm(r.start)} – ${hm(r.end)}`;
    const info = st === 'done' ? `${when} · ${durTxt(r.duration)} · ${mb(r.size)}` : st === 'failed' ? `${when} · ${esc(r.error)}` : st === 'recording' ? `${when} · nahráva sa` : when;
    const btns = (st === 'done' || st === 'recording' ? `<button class="btn small-btn f ${st === 'done' ? 'primary' : ''}" data-act="r-play" data-id="${r.id}" data-group="main">${I('play')}Prehrať</button>` : '')
      + (st === 'recording' ? `<button class="btn small-btn f" data-act="r-stop" data-id="${r.id}" data-group="main">${I('stop')}Ukončiť</button>` : '')
      + `<button class="btn small-btn f" data-act="r-del" data-id="${r.id}" data-group="main">${I(st === 'done' || st === 'failed' ? 'trash' : 'x')}${st === 'done' || st === 'failed' ? 'Zmazať' : 'Zrušiť'}</button>`;
    return `<div class="rec-row ${st}">${ch ? tileStatic(ch, 'mini') : ''}<div class="rec-i"><b>${st === 'recording' ? '<i class="rec-dot"></i>' : ''}${esc(r.title)}</b><small>${esc(r.chName)} · ${info}</small></div><div class="actions">${btns}</div></div>`;
  }).join('')).join('') : `<p class="empty">Zatiaľ nič. Nahrávanie spustíš v programe (OK na budúcej relácii → Nahrať), podržaním OK na kanáli alebo tlačidlom ⏺ v prehrávači.</p>`;
  if (focusKey) { const el = $(`#recList [data-act="${focusKey[0]}"][data-id="${focusKey[1]}"]`) || $('#recList .f'); nav.cur = null; if (el) setFocus(el, { noScroll: true }); }
}
function playRec(r) {
  const ch = byId[r.ch];
  if (!ch) { toast('Kanál tejto nahrávky už nie je v playliste'); return; }
  const go2 = () => {
    if (!P.open) { P.appFocus = nav.cur; clearFocus(); P.open = true; player.hidden = false; document.body.classList.add('playing'); cancelAnimationFrame(vid.raf); vid.last = 0; vid.raf = requestAnimationFrame(frame); }
    else if (P.mini) exitMini();
    if (P.ch && P.ch !== ch.id) P.last = P.ch;
    P.ch = ch.id; P.real = true; player.classList.add('real'); hideStatus(); $('#dog').innerHTML = '';
    P.rec = r.id; P.mode = 'archive'; P.archStart = r.recStart || r.start; P.offset = (Date.now() - P.archStart) / 1000; P.paused = false; P.prefApplied = false;
    engine.open({ url: recFileUrl(r.id), live: false, direct: true, kind: r.status === 'done' ? 'file' : 'ts' });
    renderOSD(); showBanner();
  };
  if (isLocked(ch.id)) askPin(() => { UNLOCKED = true; go2(); }); else go2();
}

/* ---------- Two pictures ---------- */
// The other pane's channel and its playback position, swapped with P when the active pane changes.
const M = { on: false, ch: null, saved: null };
const otherEngine = () => (engine === E1 ? E2 : E1);
const PANE_KEYS = ['ch', 'mode', 'offset', 'archStart', 'base', 'rec', 'paused', 'prefApplied'];
function paneLabels() {
  if (!M.on) return;
  const left = engine === E1 ? P.ch : M.ch, right = engine === E2 ? P.ch : M.ch;
  const lab = (el, id, e) => { const ch = byId[id]; el.innerHTML = ch ? `${tileStatic(ch, 'mini')}<b>${esc(ch.name)}</b>${e === engine ? I('vol') : ''}${e.state !== 'playing' && e.state !== 'idle' ? '<span class="spin"></span>' : ''}` : ''; };
  lab($('#mvL'), left, E1); lab($('#mvR'), right, E2);
  $('#mvL').classList.toggle('on', engine === E1); $('#mvR').classList.toggle('on', engine === E2);
}
function pickMulti() {
  if (!P.real) { toast('Dva obrazy fungujú len so skutočnými kanálmi'); return; }
  if (M.on) { endMulti(); return; }
  P.pick = 'multi';
  openPanel('list');
  toast('Vyber druhý kanál');
}
function startMulti(id) {
  const ch = byId[id];
  if (!ch || !ch.url) { toast('Tento kanál sa nedá pustiť'); return; }
  if (id === P.ch) { toast('Vyber iný kanál ako ten, čo už beží'); return; }
  const go2 = () => {
    if (P.mini) exitMini();
    M.on = true; M.ch = id; M.saved = { mode: 'live', offset: 0, archStart: 0, base: null, rec: null, paused: false, prefApplied: false };
    player.classList.add('multi'); player.classList.remove('solo2');
    const o = otherEngine();
    o.open(srcFor(ch, { live: true, kind: P.kinds[id] }));
    o.v.muted = true;
    pushRecent(id);
    paneLabels();
    toast('Dva obrazy · ← → prepína zvuk a ovládanie, Späť vráti jeden obraz');
  };
  if (isLocked(id)) askPin(() => { UNLOCKED = true; go2(); }); else go2();
}
/** Make the other pane active: it gets the sound, the controls and the channel keys. */
function swapPane() {
  if (!M.on) return;
  const o = otherEngine(), cur = {};
  for (const k of PANE_KEYS) cur[k] = P[k];
  const sv = M.saved || {};
  P.ch = M.ch; for (const k of PANE_KEYS.slice(1)) P[k] = sv[k];
  M.ch = cur.ch; M.saved = cur;
  engine.v.classList.remove('active'); engine.v.muted = true;
  engine = o;
  engine.v.classList.add('active');
  applyVolume();
  player.classList.toggle('paused', !!P.paused);
  hideStatus(); if (engine.state !== 'playing') engineState(engine.state, {});
  renderOSD(); renderSubs(true); paneLabels();
  if (!P.osd && !P.panel) showBanner();
}
/** Back to one picture, keeping the active pane. */
function endMulti() {
  if (!M.on) return;
  otherEngine().close();
  M.on = false; M.ch = null; M.saved = null;
  player.classList.remove('multi');
  $('#mvL').innerHTML = ''; $('#mvR').innerHTML = '';
  // The active player may be the right one; put it on the main element's place again.
  player.classList.toggle('solo2', engine === E2);
}

/* ---------- Sleep timer ---------- */
const SLEEP = { at: 0, kind: '', warned: false };
const SLEEP_OPTS = [['0', 'Vypnutý'], ['15', '15 minút'], ['30', '30 minút'], ['60', '1 hodina'], ['90', '1,5 hodiny'], ['120', '2 hodiny'], ['end', 'Do konca relácie']];
const sleepLeft = () => { const m = Math.max(0, Math.ceil((SLEEP.at - Date.now()) / 60e3)); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
function sleepSheet() {
  const ch = byId[P.ch], pos = Date.now() - P.offset * 1000, p = ch ? progAt(ch.id, pos) : { none: true };
  return `<div class="panel-head"><h3>Časovač vypnutia</h3>${SLEEP.at ? `<span>ešte ${sleepLeft()}</span>` : ''}</div><div class="plist">` +
    SLEEP_OPTS.filter(([v]) => v !== 'end' || !p.none).map(([v, l]) => `<button class="opt f ${(SLEEP.kind || '0') === v ? 'on' : ''}" data-act="sleep" data-v="${v}"><span>${l}${v === 'end' ? `<small>${esc(p.title)} · do ${hm(p.end)}</small>` : ''}</span>${I('check')}</button>`).join('') +
    `<p class="opt-note">Minútu pred koncom sa ukáže upozornenie, prehrávanie sa dá predĺžiť.</p></div>`;
}
function setSleep(v) {
  SLEEP.warned = false;
  if (v === '0') { SLEEP.at = 0; SLEEP.kind = ''; toast('Časovač vypnutý'); }
  else if (v === 'end') {
    const ch = byId[P.ch], pos = Date.now() - P.offset * 1000, p = progAt(ch.id, pos);
    if (p.none) return;
    // In stream time: what is left of the programme at the current position, not on the wall clock.
    SLEEP.at = Date.now() + Math.max(60e3, p.end - pos); SLEEP.kind = 'end';
    toast(`Vypnem po skončení: ${p.title}`);
  } else { SLEEP.at = Date.now() + +v * 60e3; SLEEP.kind = v; toast(`Vypnem o ${sleepLeft()}`); }
  $('#cSleep').classList.toggle('on', !!SLEEP.at);
  if (P.panel === 'sleep') { renderSheet('sleep'); setFocus($('#sheet .opt.on') || $('#sheet .f')); }
  if (P.osd) renderOSD();
}
function checkSleep() {
  if (!SLEEP.at) return;
  if (!P.open) { SLEEP.at = 0; SLEEP.kind = ''; $('#cSleep').classList.remove('on'); return; }
  const left = SLEEP.at - Date.now();
  if (left <= 0) {
    SLEEP.at = 0; SLEEP.kind = ''; $('#cSleep').classList.remove('on');
    if (!modal.hidden && $('#modal .sleep-warn')) closeModal();
    closePlayer();
    toast('Časovač vypol prehrávanie. Dobrú noc.');
    return;
  }
  if (left < 60e3 && !SLEEP.warned) {
    SLEEP.warned = true;
    openModal(`<div class="sleep-warn"><h2>Prehrávanie sa o minútu zastaví</h2><p class="muted">Časovač vypnutia čoskoro skončí.</p>
      <div class="actions"><button class="btn primary f" data-act="sleep-more">${I('plus')}Pozerať ďalších 30 minút</button><button class="btn f" data-act="sleep-off">Vypnúť časovač</button><button class="btn f" data-act="close-modal">OK</button></div></div>`);
  }
}
setInterval(checkSleep, 1000);

function renderSheet(name) {
  if (name === 'sleep') { sheet.innerHTML = sleepSheet(); return; }
  if (name === 'audio' && P.real) { sheet.innerHTML = realAudioSheet(); return; }
  if (name === 'audio') {
    const sec = (title, k, list) => `<div class="sheet-sec">${title}</div>` + list.map(([v, l, s]) =>
      `<button class="opt f ${P[k] === v ? 'on' : ''}" data-act="opt" data-k="${k}" data-v="${v}"><span>${l}${s ? `<small>${s}</small>` : ''}</span>${I('check')}</button>`).join('');
    sheet.innerHTML = `<div class="panel-head"><h3>Zvuk a titulky</h3></div><div class="plist">${sec('Zvuková stopa', 'audio', AUDIO)}${sec('Titulky', 'subs', SUBS)}${sec('Kvalita', 'quality', QUAL)}${sec('Pomer strán', 'aspect', ASPECT)}</div>`;
  } else {
    const ch = byId[P.ch], now = Date.now(), pos = now - P.offset * 1000;
    const list = progsIn(ch.id, now - 12 * 60 * MIN, now + 14 * 60 * MIN).filter(p => !p.none);
    if (!list.length) { sheet.innerHTML = `<div class="panel-head"><h3>${esc(ch.name)}</h3><span>Program</span></div><div class="plist"><p class="opt-note">Pre tento kanál nie je k dispozícii program (EPG).</p></div>`; return; }
    sheet.innerHTML = `<div class="panel-head"><h3>${esc(ch.name)}</h3><span>Program</span></div><div class="plist">` + list.map(p => {
      const st = p.end <= now ? 'past' : p.start <= now ? 'now' : 'future';
      const playing = pos >= p.start && pos < p.end;
      const right = st === 'past' ? (hasArchive(ch, p.start) ? `${I('hist')}${playing ? 'Prehráva sa' : 'Archív'}` : 'Bez archívu') : st === 'now' ? `<i class="dot"></i>${playing ? 'Teraz' : 'Naživo'}` : (S.rem.has(ch.id + ':' + p.start) ? I('bell') : '');
      return `<button class="pr f ${st}" data-act="sprog" data-ch="${ch.id}" data-start="${p.start}"><span class="pr-time">${hm(p.start)}</span><span class="pr-t"><b>${esc(p.title)}</b><small>${p.genre}</small></span><span class="pr-st">${right}</span></button>`;
    }).join('') + `</div>`;
  }
}
function setOpt(k, v) {
  P[k] = v;
  $$(`#sheet .opt[data-k="${k}"]`).forEach(b => b.classList.toggle('on', b.dataset.v === v));
  if (k === 'aspect') { $('#video').className = v === 'fit' ? '' : 'ar-' + v; for (const e of [E1, E2]) { e.v.classList.remove('ar-fill', 'ar-zoom', 'ar-43'); if (v !== 'fit') e.v.classList.add('ar-' + v); } }
  if (k === 'subs') renderSubs(true);
  if (k === 'audio') toast(`Zvuk: ${label(AUDIO, v)}`);
  if (k === 'quality') { vid.noise = performance.now() + 200; toast(`Kvalita: ${label(QUAL, v)}`); }
  renderOSD();
}
const SUB_LINES = {
  sk: ['Počkaj, ešte sme neskončili.', 'Vieš, kde bola v ten večer?', 'Zajtra ráno ti všetko vysvetlím.', 'Toto sú ukážkové titulky.'],
  en: ['Wait, we are not done yet.', 'Do you know where she was that night?', 'I will explain everything tomorrow morning.', 'These are sample subtitles.'],
};
let subI = 0;
function renderSubs(reset) {
  const el = $('#subs');
  if (P.subs === 'off' || !P.open) { el.hidden = true; return; }
  if (reset) subI = 0;
  el.hidden = false; el.textContent = SUB_LINES[P.subs][subI % 4];
}

/* Fake picture: drifting light in the channel's colours */
const cv = $('#video'), cx = cv.getContext('2d');
const vid = { raf: 0, t: Math.random() * 100, last: 0, noise: 0, frozen: false };
const noiseCv = document.createElement('canvas'); noiseCv.width = 128; noiseCv.height = 72;
const ncx = noiseCv.getContext('2d'), noiseImg = ncx.createImageData(128, 72);
const hexA = (h, a) => { const n = parseInt(String(h || '#888888').slice(1), 16) || 0x888888; return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
function frame(ts) {
  vid.raf = requestAnimationFrame(frame);
  const dt = vid.last ? Math.min(0.05, (ts - vid.last) / 1000) : 0; vid.last = ts;
  const ch = byId[P.ch]; if (!ch || P.real) return;
  const W = cv.width, H = cv.height;
  if (ts < vid.noise) {
    const d = noiseImg.data;
    for (let i = 0; i < d.length; i += 4) { const v = Math.random() * 200 | 0; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    ncx.putImageData(noiseImg, 0, 0); cx.imageSmoothingEnabled = false; cx.drawImage(noiseCv, 0, 0, W, H); cx.imageSmoothingEnabled = true;
    return;
  }
  if (P.paused) { if (vid.frozen) return; vid.frozen = true; } else vid.t += dt;
  const t = vid.t, seed = CH.indexOf(ch) * 1.7;
  cx.globalCompositeOperation = 'source-over';
  cx.fillStyle = '#06070B'; cx.fillRect(0, 0, W, H);
  cx.globalCompositeOperation = 'lighter';
  const cols = [ch.c1, ch.c2, ch.c1];
  for (let i = 0; i < 3; i++) {
    const x = W * (0.5 + 0.38 * Math.sin(t * 0.23 * (i + 1) + seed + i * 2.1));
    const y = H * (0.5 + 0.32 * Math.cos(t * 0.19 * (i + 1.3) + seed * 0.5 + i));
    const r = H * (0.55 + 0.18 * Math.sin(t * 0.4 + i));
    const g = cx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, hexA(cols[i], i === 1 ? 0.35 : 0.5)); g.addColorStop(1, hexA(cols[i], 0));
    cx.fillStyle = g; cx.fillRect(0, 0, W, H);
  }
  cx.globalCompositeOperation = 'source-over';
  const v = cx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.7);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.55)');
  cx.fillStyle = v; cx.fillRect(0, 0, W, H);
}

/* Night look: slow neon light ribbons behind the content */
const wv = $('#waves'), wx = wv.getContext('2d');
let wvT = 0, wvLast = 0;
const RIBBONS = [[258, .26, 1, .9], [196, .36, -1, .7], [312, .31, 1, .55]];
function waves(ts) {
  requestAnimationFrame(waves);
  if (S.set.look !== 'classic' || P.open || document.hidden) { wvLast = 0; return; }
  if (wvLast && ts - wvLast < 40) return;
  if (!reduceMotion && wvLast) wvT += (ts - wvLast) / 1000;
  wvLast = ts;
  const W = wv.width, H = wv.height;
  wx.clearRect(0, 0, W, H);
  wx.globalCompositeOperation = 'lighter';
  RIBBONS.forEach(([hue, yb, dir, amp], k) => {
    for (let j = 0; j < 18; j++) {
      wx.beginPath();
      for (let x = -10; x <= W + 10; x += 12) {
        const y = H * yb
          + Math.sin(x * 0.0058 + wvT * 0.32 * dir + k * 1.7 + j * 0.085) * H * 0.11 * amp
          + Math.sin(x * 0.0125 - wvT * 0.21 + j * 0.05 + k) * H * 0.045 * (1 + j * 0.05)
          + j * 1.8;
        if (x < 0) wx.moveTo(x, y); else wx.lineTo(x, y);
      }
      wx.strokeStyle = `hsla(${hue + j * 2}, 95%, ${60 + j}%, ${0.16 - j * 0.0065})`;
      wx.lineWidth = j % 6 === 0 ? 3 : 1.1;
      wx.stroke();
    }
  });
  wx.globalCompositeOperation = 'source-over';
}

/* ---------- Volume & fullscreen (PC; a TV uses its own remote volume) ---------- */
const IS_TV = /Web0S|webOS|SmartTV|Tizen|AFT\w|Android TV|BRAVIA|GoogleTV/i.test(navigator.userAgent);
function applyVolume() { const v = engine.v; v.volume = Math.max(0, Math.min(1, +S.set.vol || 1)); v.muted = S.set.muted === 'on'; updateMuteBtn(); }
function updateMuteBtn() { const b = $('#cMute'); if (!b) return; const m = engine.v.muted; $('use', b).setAttribute('href', m ? '#i-mute' : '#i-vol'); $('.tip', b).textContent = m ? 'Zapnúť zvuk' : 'Stlmiť'; }
function setMuted(m) { S.set.muted = m ? 'on' : 'off'; store.set('settings3', S.set); applyVolume(); toast(m ? 'Zvuk stlmený' : `Hlasitosť ${Math.round(engine.v.volume * 100)} %`); }
function changeVolume(d) { S.set.vol = String(Math.max(0, Math.min(1, Math.round(((+S.set.vol || 1) + d) * 10) / 10))); S.set.muted = 'off'; store.set('settings3', S.set); applyVolume(); toast(`Hlasitosť ${Math.round(engine.v.volume * 100)} %`); }
function toggleFullscreen() {
  try {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => toast('Celá obrazovka tu nie je dostupná'));
  } catch { toast('Celá obrazovka tu nie je dostupná'); }
}

/* ---------- Number entry ---------- */
function numKey(d) {
  P.num = (P.num + d).slice(-3);
  const el = $('#numEntry'); el.textContent = P.num; el.hidden = false;
  clearTimeout(P.numT); P.numT = setTimeout(commitNum, 1400);
}
function commitNum() {
  const n = +P.num; P.num = ''; $('#numEntry').hidden = true;
  const c = CH.find(x => x.n === n);
  if (c) openOrTune(c.id); else toast(`Kanál ${n} neexistuje`);
}

/* ---------- Modal ---------- */
let modalBack = null;
function openModal(html) {
  if (modal.hidden) modalBack = nav.cur;
  clearFocus();
  $('#dialog').innerHTML = html; modal.hidden = false;
  setFocus($('#dialog .f'));
}
function closeModal(noRestore) {
  modal.hidden = true; clearFocus(); PINE = null;
  const back = modalBack; modalBack = null;
  if (!noRestore) { const t = twin(back); if (t && visible(t)) setFocus(t, { noScroll: true }); }
}
function openHelp() {
  openModal(`<h2>Ovládanie</h2>
    <div class="help-grid">
      <div><h4>Menu</h4><dl><dt>Šípky</dt><dd>pohyb</dd><dt>OK / Enter</dt><dd>vybrať</dd><dt>Podržať OK</dt><dd>ponuka kanála (aj pravé tlačidlo myši)</dd><dt>Späť / Esc</dt><dd>späť</dd><dt>0 – 9</dt><dd>prepnúť na číslo kanála</dd></dl></div>
      <div><h4>Prehrávač</h4><dl><dt>↑ ↓, CH+ CH−</dt><dd>ďalší a predchádzajúci kanál</dd><dt>←</dt><dd>zoznam kanálov</dd><dt>→</dt><dd>program kanála</dd><dt>OK</dt><dd>ovládanie</dd><dt>Medzerník, ⏯</dt><dd>pauza</dd><dt>⏪ ⏩</dt><dd>±30 s</dd><dt>L</dt><dd>posledný kanál</dd><dt>I</dt><dd>info o relácii</dd><dt>M, + −</dt><dd>stlmiť, hlasitosť (PC)</dd><dt>F, dvojklik</dt><dd>celá obrazovka (PC)</dd><dt>D, modré</dt><dd>štatistiky prehrávania</dd><dt>P, červené</dt><dd>malé okienko a späť</dd></dl></div>
      <div><h4>Dotyk a myš</h4><dl><dt>Ťuknutie</dt><dd>ovládanie</dd><dt>Potiahnutie ↑ ↓</dt><dd>zmena kanála</dd><dt>Klik na lištu</dt><dd>pretáčanie</dd></dl></div>
    </div>
    <div class="actions"><button class="btn primary f" data-act="close-modal">Rozumiem</button></div>`);
}
function openPlaylist(isNew) {
  const src = !isNew && LIB ? LIB.source : { name: '', m3u: '', epg: '', ua: '' };
  openModal(`<h2>${isNew ? 'Pridať playlist' : 'Upraviť playlist'}</h2>
    <p class="muted">Adresy sa uložia len v tomto zariadení. Playlist a program (EPG) sa potom obnovujú samy.</p>
    <div class="seg" id="plType"><button class="f on" data-act="pltype" data-v="m3u">M3U odkaz</button><button class="f" data-act="pltype" data-v="xt">Xtream Codes</button></div>
    <div class="field"><label for="plName">Názov</label><input id="plName" class="f" value="${esc(src.name)}" placeholder="Napríklad Môj IPTV" autocomplete="off"></div>
    <div id="plM3u" style="display:grid;gap:18px">
      <div class="field"><label for="plUrl">Adresa playlistu (M3U)</label><input id="plUrl" class="f" value="${esc(src.m3u)}" placeholder="http://poskytovatel.example/playlist.m3u" autocomplete="off" spellcheck="false"></div>
    </div>
    <div id="plXt" style="display:grid;gap:18px" hidden>
      <div class="field"><label for="xtServer">Server</label><input id="xtServer" class="f" placeholder="http://server.example:8080" autocomplete="off" spellcheck="false"></div>
      <div class="field"><label for="xtUser">Používateľ</label><input id="xtUser" class="f" autocomplete="off" spellcheck="false"></div>
      <div class="field"><label for="xtPass">Heslo</label><input id="xtPass" class="f" type="password" autocomplete="off"></div>
    </div>
    <div class="field"><label for="plEpg">Program (EPG, XMLTV) – nepovinné</label><input id="plEpg" class="f" value="${esc(src.epg)}" placeholder="Prázdne = adresa uvedená v playliste" autocomplete="off" spellcheck="false"></div>
    <div class="field"><label for="plUa">User-Agent – nepovinné</label><input id="plUa" class="f" value="${esc(src.ua)}" placeholder="Len ak to poskytovateľ vyžaduje" autocomplete="off" spellcheck="false"></div>
    <div class="actions"><button class="btn f" data-act="close-modal">Zrušiť</button><button class="btn primary f" data-act="save-playlist">${isNew ? 'Načítať' : 'Uložiť a načítať'}</button></div>`);
}

/* ---------- Actions ---------- */
function activate(el, e) {
  if (!el) return;
  const a = el.dataset.act, id = el.dataset.ch;
  switch (a) {
    case 'screen': go(el.dataset.screen); break;
    case 'play': openOrTune(id); break;
    case 'cat': S.catId = el.dataset.sec; nav.mem['main:cat'] = null; go('cat'); break;
    case 'look': setSetting('look', S.set.look === 'glass' ? 'classic' : 'glass'); break;
    case 'chip': {
      const w = el.dataset.which, v = el.dataset.v;
      if (w === 'ch') { S.chipCh = v; renderChannels(); } else { S.chipGuide = v; renderGuide(); }
      nav.cur = null; setFocus($(`[data-act="chip"][data-which="${w}"][data-v="${v}"]`), { noScroll: true });
      break;
    }
    case 'prog': progAction(id, +el.dataset.start); break;
    case 'rprog': { const st = +el.dataset.start, r = progAction(id, st); if (r === 'rem') { const p = findProg(id, st); el.outerHTML = progRes(byId[id], p, 'later'); setFocus($(`#results [data-act="rprog"][data-ch="${id}"][data-start="${st}"]`), { noScroll: true }); } break; }
    case 'gday': gDay = +el.dataset.v; renderGuide(); nav.cur = null; setFocus($(`[data-act="gday"][data-v="${gDay}"]`), { noScroll: true }); break;
    case 'set': setSetting(el.dataset.k, el.dataset.v, el); break;
    case 'playlist': openPlaylist(!!el.dataset.new); break;
    case 'help': openHelp(); break;
    case 'reset':
      S.set = Object.assign({}, DEFAULT_SET); S.sections = defaultSections(); S.quick = DEFAULTS.quick.slice(); S.recent = DEFAULTS.recent.slice(); S.rem = new Set();
      S.order = CH.map(c => c.id); renumber();
      save(); store.set('recent:' + S.libKey, S.recent); store.set('rem:' + S.libKey, []);
      applySettings(); renderSettings(); setFocus($('[data-act="reset"]'), { noScroll: true }); toast('Ukážka obnovená');
      break;
    case 'close-modal': closeModal(); break;
    case 'save-playlist': {
      let m3u = $('#plUrl').value.trim(), epg = $('#plEpg').value.trim();
      if (!$('#plXt').hidden) {
        const sv = $('#xtServer').value.trim(), u = $('#xtUser').value.trim(), pw = $('#xtPass').value;
        if (!sv || !u || !pw) { toast('Vyplň server, meno aj heslo.'); break; }
        const x = xtreamUrls(/^https?:\/\//i.test(sv) ? sv : 'http://' + sv, u, pw);
        m3u = x.m3u; epg = epg || x.epg;
      }
      if (!/^https?:\/\//i.test(m3u)) { toast('Adresa playlistu musí začínať http:// alebo https://'); setFocus($('#plUrl')); break; }
      const src = { name: $('#plName').value.trim() || 'Môj IPTV', m3u, epg, ua: $('#plUa').value.trim() };
      closeModal();
      if (S.screen !== 'settings') go('settings');
      importPlaylist(src);
      break;
    }
    case 'pl-refresh': if (LIB) importPlaylist(LIB.source); break;
    case 'pl-remove': {
      if (!el.classList.contains('armed')) { el.classList.add('armed'); toast('Stlač ešte raz a playlist sa odstráni z tohto zariadenia'); setTimeout(() => el.classList.remove('armed'), 3000); break; }
      library.clearLibrary().then(() => { useDemo(); setLibStatus(''); nav.mem = {}; go('settings'); toast('Playlist odstránený, zobrazujú sa ukážkové kanály'); });
      break;
    }
    case 'pltype':
      $$('#plType button').forEach(b => b.classList.toggle('on', b === el));
      $('#plM3u').hidden = el.dataset.v !== 'm3u'; $('#plXt').hidden = el.dataset.v === 'm3u';
      break;

    /* organizer */
    case 'org-open': S.orgSel = el.dataset.id || 'quick'; nav.mem['main:organize'] = null; go('organize'); break;
    case 'org-sel':
      S.orgSel = el.dataset.id; renderOrganizer(); refocusOrg(el);
      if (!isWide()) $('#orgRight').scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
      break;
    case 's-up': case 's-down': {
      const i = S.sections.findIndex(s => s.id === el.dataset.id), j = i + (a === 's-up' ? -1 : 1);
      if (i < 0 || j < 0 || j >= S.sections.length) break;
      [S.sections[i], S.sections[j]] = [S.sections[j], S.sections[i]];
      save(); renderOrganizer(); refocusOrg(el);
      break;
    }
    case 's-eye': { const s = secById(el.dataset.id); s.show = !s.show; save(); renderOrganizer(); refocusOrg(el); toast(s.show ? `${s.name} sa zobrazí na domovskej obrazovke` : `${s.name} je skrytá`); break; }
    case 's-pin': {
      const sid = el.dataset.id, qi = S.quick.indexOf(sid);
      if (qi >= 0) S.quick.splice(qi, 1); else S.quick.push(sid);
      save(); renderOrganizer(); refocusOrg(el); toast(qi >= 0 ? 'Tlačidlo odobraté z vrchu' : 'Pridané ako tlačidlo na vrchu');
      break;
    }
    case 's-edit': openCatModal(el.dataset.id); break;
    case 's-del': {
      if (!el.classList.contains('armed')) { el.classList.add('armed'); toast('Stlač ešte raz a kategória sa zmaže'); setTimeout(() => el.classList.remove('armed'), 3000); break; }
      const sid = el.dataset.id, name = secById(sid).name;
      S.sections = S.sections.filter(s => s.id !== sid); S.quick = S.quick.filter(q => q !== sid);
      if (S.orgSel === sid) S.orgSel = 'quick';
      save(); renderOrganizer(); nav.cur = null; setFocus($('#orgLeft .org-main')); toast(`Kategória ${name} zmazaná`);
      break;
    }
    case 'new-cat': openCatModal(null); break;
    case 'grab': if (GRAB && GRAB.id === el.dataset.id) { endGrab(); toast('Poradie uložené'); } else startGrab(el); break;
    case 'o-up': case 'o-down': {
      const arr = listRef(el.dataset.list), i = arr.indexOf(el.dataset.id);
      if (i < 0) break;
      endGrab();
      GRAB = { list: el.dataset.list, id: el.dataset.id, digits: '' };
      grabTo(i + (a === 'o-up' ? -1 : 1));
      GRAB = null;
      const row = $(`#orgList .org-row[data-row="${CSS.escape(el.dataset.id)}"]`);
      const btn = row && ($(`[data-act="${a}"]`, row).disabled ? $(`[data-act="${a === 'o-up' ? 'o-down' : 'o-up'}"]`, row) : $(`[data-act="${a}"]`, row));
      if (btn) { nav.cur = null; setFocus(btn); }
      if (el.dataset.list === 'quick') renderOrgLeftCounts();
      break;
    }
    case 'o-rm': {
      const arr = listRef(el.dataset.list), i = arr.indexOf(el.dataset.id);
      if (i < 0) break;
      arr.splice(i, 1); save(); renderOrganizer();
      const rms = $$(`#orgRight [data-act="o-rm"]`);
      nav.cur = null; setFocus(rms[Math.min(i, rms.length - 1)] || $('#orgRight .f') || pickDefault());
      break;
    }
    case 'o-add': openPicker(el.dataset.list); break;
    case 'pick': {
      const arr = listRef(PK), i = arr.indexOf(el.dataset.id);
      if (i >= 0) arr.splice(i, 1); else arr.push(el.dataset.id);
      el.classList.toggle('on', i < 0); save();
      break;
    }
    case 'pick-done': closeModal(true); if (S.screen === 'organize') { renderOrganizer(); nav.cur = null; setFocus($(`#orgRight [data-act="o-add"]`) || pickDefault()); } else rerender(); break;
    case 'mpick': {
      const sec = secById(el.dataset.id), cid = PK && PK.member;
      if (!sec || !cid) break;
      const i = sec.chs.indexOf(cid);
      if (i >= 0) sec.chs.splice(i, 1); else sec.chs.push(cid);
      el.classList.toggle('on', i < 0); save();
      break;
    }
    case 'm-play': closeModal(true); openOrTune(el.dataset.ch); break;
    case 'm-restart': { const p = progAt(el.dataset.ch, Date.now()); closeModal(true); openOrTune(el.dataset.ch, (Date.now() - p.start) / 1000); break; }
    case 'm-fav': toggleFav(el.dataset.ch); closeModal(); break;
    case 'm-cats': openMemberPicker(el.dataset.ch); break;
    case 'm-rec': closeModal(true); recordNow(el.dataset.ch); break;
    case 'p-rec': recordNow(P.ch); break;
    case 'f-rem': { const ch = el.dataset.ch, st = +el.dataset.start; closeModal(); S.rem.add(ch + ':' + st); store.set('rem:' + S.libKey, [...S.rem]); toast(`Pripomeniem: ${findProg(ch, st).title} o ${hm(st)}`); afterProgChange(ch, st); break; }
    case 'f-unrem': { const ch = el.dataset.ch, st = +el.dataset.start; closeModal(); S.rem.delete(ch + ':' + st); store.set('rem:' + S.libKey, [...S.rem]); toast('Pripomienka zrušená'); afterProgChange(ch, st); break; }
    case 'f-rec': { const ch = el.dataset.ch, st = +el.dataset.start; closeModal(); const p = findProg(ch, st); scheduleRec(byId[ch], p.title, p.start, p.end).then(() => afterProgChange(ch, st)); break; }
    case 'f-unrec': case 'r-del': { const r = RECS.find(x => x.id === el.dataset.id); if (S.screen !== 'recs') closeModal(); if (r) removeRec(r); break; }
    case 'r-play': { const r = RECS.find(x => x.id === el.dataset.id); if (r) playRec(r); break; }
    case 'r-stop': { const r = RECS.find(x => x.id === el.dataset.id); if (r) recStop(r.id).then(refreshRecs).catch(e => toast(e.message)); break; }
    case 'm-lock': { const ch = el.dataset.ch; closeModal(true); toggleChannelLock(ch); break; }
    case 'pin-d': pinDigit(el.dataset.v); break;
    case 'pin-del': pinDigit('del'); break;
    case 'pin-change': {
      const set = () => askPin(() => { UNLOCKED = true; toast('PIN nastavený'); renderLockRows(); }, { mode: 'set' });
      if (pinHash()) askPin(() => setTimeout(set, 50), { sub: 'Najprv zadaj súčasný PIN.' }); else set();
      break;
    }
    case 'pin-remove': askPin(() => { store.set('pin', ''); UNLOCKED = false; toast('Rodičovský zámok zrušený'); renderLockRows(); }, { sub: 'Na zrušenie zámku zadaj PIN.' }); break;
    case 'lock-now': UNLOCKED = false; toast('Zamknuté'); renderLockRows(); break;
    case 'lock-cats': withPin(openLockCats, { sub: 'Na zmenu zámku treba PIN.' }); break;
    case 'lock-cat': {
      const sid = el.dataset.id, on = !LOCK.cats.includes(sid);
      LOCK.cats = on ? [...LOCK.cats, sid] : LOCK.cats.filter(x => x !== sid); saveLock();
      el.querySelector('svg use').setAttribute('href', on ? '#i-lock' : '#i-unlock');
      break;
    }
    case 'p-mute': setMuted(!engine.v.muted); break;
    case 'p-full': toggleFullscreen(); break;
    case 'clear-recent': S.recent = []; store.set('recent:' + S.libKey, []); renderOrganizer(); nav.cur = null; setFocus(pickDefault()); toast('História vymazaná'); break;
    case 'cm-color': CM.color = el.dataset.v; $$('[data-act="cm-color"]').forEach(b => b.classList.toggle('on', b === el)); break;
    case 'cm-icon': CM.icon = el.dataset.v; $$('[data-act="cm-icon"]').forEach(b => b.classList.toggle('on', b === el)); break;
    case 'cm-pin': CM.pin = !CM.pin; el.classList.toggle('on', CM.pin); break;
    case 'cm-save': {
      const name = $('#cmName').value.trim() || 'Moja kategória';
      let created = false;
      if (CM.id) { const s = secById(CM.id); s.name = name; s.color = CM.color; s.icon = CM.icon; }
      else { const s = { id: 'u' + Date.now().toString(36), type: 'cat', custom: true, name, color: CM.color, icon: CM.icon, show: true, chs: [] }; S.sections.push(s); CM.id = s.id; created = true; }
      const qi = S.quick.indexOf(CM.id);
      if (CM.pin && qi < 0) S.quick.push(CM.id);
      if (!CM.pin && qi >= 0) S.quick.splice(qi, 1);
      save(); closeModal(true);
      S.orgSel = CM.id;
      if (S.screen !== 'organize') go('organize', false); else renderOrganizer();
      renderOrganizer();
      if (created) { toast(`Kategória ${name} vytvorená`); openPicker(CM.id); }
      else { nav.cur = null; setFocus($(`#orgLeft .org-main[data-id="${CM.id}"]`)); toast('Uložené'); }
      break;
    }

    /* player */
    case 'p-close': closePlayer(); break;
    case 'p-mini': enterMini(); break;
    case 'p-sleep': openPanel('sleep'); break;
    case 'sleep': setSleep(el.dataset.v); break;
    case 'sleep-more': closeModal(); setSleep('30'); break;
    case 'sleep-off': closeModal(); setSleep('0'); break;
    case 'mini-expand': exitMini(); break;
    case 'mini-close': closePlayer(); break;
    case 'mini-native': nativePip(); break;
    case 'p-pause': togglePause(); break;
    case 'p-rew': seek(-30); break;
    case 'p-ff': seek(30); break;
    case 'p-live': toLive(); break;
    case 'p-restart': restartProg(); break;
    case 'p-up': step(1); break;
    case 'p-down': step(-1); break;
    case 'p-list': openPanel('list'); break;
    case 'p-prog': openPanel('prog'); break;
    case 'p-audio': openPanel('audio'); break;
    case 'p-fav': toggleFav(P.ch); break;
    case 'tune': { const pick = P.pick; closePanel(true); if (pick === 'multi') startMulti(id); else tune(id); break; }
    case 'p-multi': pickMulti(); break;
    case 'sprog': { const r = progAction(id, +el.dataset.start); if (r === 'play') closePanel(true); break; }
    case 'opt': setOpt(el.dataset.k, el.dataset.v); break;
    case 'eopt': {
      const k = el.dataset.k, v = +el.dataset.v;
      if (k === 'audio') engine.setAudio(v); else if (k === 'text') engine.setText(v); else engine.setQuality(v);
      refreshSheet();
      break;
    }
    case 'p-retry': hideStatus(); engine.retry(); break;
    case 'seek': {
      if (!e || e.clientX == null) break;
      const r = $('.track', el).getBoundingClientRect(), f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const now = Date.now(), p = progAt(P.ch, now - P.offset * 1000);
      const target = Math.max(0, (now - Math.min(now, p.start + f * (p.end - p.start))) / 1000);
      if (P.real) seekReal(P.offset - target);
      else { P.offset = target < 3 ? 0 : target; }
      renderOSD(); armHide();
      break;
    }
  }
}

/* ---------- Keys ---------- */
function keyName(e) {
  const k = e.key, c = e.keyCode;
  if (k === 'ArrowUp' || c === 38) return 'up';
  if (k === 'ArrowDown' || c === 40) return 'down';
  if (k === 'ArrowLeft' || c === 37) return 'left';
  if (k === 'ArrowRight' || c === 39) return 'right';
  if (k === 'Enter' || c === 13) return 'ok';
  if (k === 'Escape' || c === 461 || k === 'GoBack' || k === 'BrowserBack') return 'back';
  if (k === 'Backspace') return 'bksp';
  if (k === 'PageUp' || k === 'ChannelUp' || c === 33 || c === 427) return 'chup';
  if (k === 'PageDown' || k === 'ChannelDown' || c === 34 || c === 428) return 'chdown';
  if (k === ' ' || k === 'MediaPlayPause' || k === 'MediaPlay' || k === 'MediaPause' || c === 415 || c === 19) return 'playpause';
  if (k === 'MediaRewind' || c === 412) return 'rew';
  if (k === 'MediaFastForward' || c === 417) return 'ff';
  if (/^[0-9]$/.test(k)) return k;
  if (k === '?' || k === 'h' || k === 'H') return 'help';
  if (k === 'l' || k === 'L') return 'last';
  if (k === 'i' || k === 'I') return 'info';
  if (k === 'm' || k === 'M' || k === 'AudioVolumeMute' && !IS_TV) return 'mute';
  if (k === '+' || k === '=') return 'volup';
  if (k === '-' || k === '_') return 'voldown';
  if (k === 'f' || k === 'F') return 'full';
  if (k === 'd' || k === 'D' || c === 406) return 'stats';
  if (k === 'p' || k === 'P' || c === 403) return 'mini';
  if (k === 'ContextMenu' || c === 93) return 'menu';
  if (k === 'MediaStop' || c === 413) return 'stop';
  return null;
}
const DIRS = { up: 1, down: 1, left: 1, right: 1 };
document.addEventListener('keydown', e => {
  const k = keyName(e); if (!k) return;
  const inInput = e.target && e.target.tagName === 'INPUT';
  if (inInput && !(k === 'up' || k === 'down' || k === 'ok' || k === 'back')) return;
  document.body.classList.remove('touch');
  e.preventDefault();
  if (!modal.hidden) {
    if (PINE && $('#pinDots')) { if (/^\d$/.test(k)) return pinDigit(k); if (k === 'bksp') return pinDigit('del'); }
    if (k === 'back') return closeModal();
    if (k === 'ok') return inInput ? move('down') : activate(nav.cur);
    if (DIRS[k]) move(k);
    return;
  }
  if (P.mini) {
    if (k === 'mini') return exitMini();
    if (k === 'chup') return step(1);
    if (k === 'chdown') return step(-1);
    if (k === 'mute') return setMuted(!engine.v.muted);
    if (k === 'volup') return changeVolume(0.1);
    if (k === 'voldown') return changeVolume(-0.1);
    if (k === 'playpause') return togglePause();
    if (k === 'stop') return closePlayer();
    // Back with nothing left to go back to (focus already on the top menu) closes the mini player.
    if ((k === 'back' || k === 'bksp') && S.screen === 'home' && nav.cur && nav.cur.closest('.topbar')) { closePlayer(); toast('Okienko zatvorené'); return; }
  }
  if (P.open && !P.mini) return playerKey(k);
  if (GRAB) { grabKey(k); return; }
  if (inInput && k === 'ok') { move('down'); return; }
  if (k === 'menu') { if (nav.cur && nav.cur.dataset.ch) openChannelMenu(nav.cur.dataset.ch); return; }
  // Hold OK on a channel for its menu; a short press plays it (decided on key release).
  if (k === 'ok' && nav.cur && nav.cur.dataset.act === 'play' && nav.cur.dataset.ch) {
    if (e.repeat || okHold) return;
    const el = nav.cur;
    okHold = { el, fired: false, t: setTimeout(() => { if (okHold) okHold.fired = true; openChannelMenu(el.dataset.ch); }, 550) };
    return;
  }
  if (DIRS[k]) { move(k); return; }
  if (k === 'ok') { if (nav.cur) activate(nav.cur); else setFocus(pickDefault()); return; }
  if (k === 'back' || k === 'bksp') {
    if (nav.cur && nav.cur.closest('.topbar')) { setFocus(pickDefault()); return; }
    if (S.screen === 'organize') { endGrab(); go('settings'); return; }
    if (S.screen !== 'home') { go('home'); return; }
    setFocus($('#topnav .nav-item.active'));
    return;
  }
  if (/^\d$/.test(k)) return numKey(k);
  if (k === 'help') return openHelp();
});
let okHold = null;
document.addEventListener('keyup', e => {
  if (!okHold || keyName(e) !== 'ok') return;
  clearTimeout(okHold.t);
  const h = okHold; okHold = null;
  if (!h.fired) activate(h.el);
});
document.addEventListener('contextmenu', e => {
  const c = e.target.closest && e.target.closest('[data-act="play"][data-ch]');
  if (!c || P.open) return;
  e.preventDefault();
  openChannelMenu(c.dataset.ch);
});
function playerKey(k) {
  if (/^\d$/.test(k)) return numKey(k);
  if (k === 'stop') return closePlayer();
  if (k === 'mute') return setMuted(!engine.v.muted);
  if (k === 'volup') return changeVolume(0.1);
  if (k === 'voldown') return changeVolume(-0.1);
  if (k === 'full') return toggleFullscreen();
  if (k === 'stats') return toggleStats();
  if (k === 'mini') return enterMini();
  if (k === 'chup') return step(1);
  if (k === 'chdown') return step(-1);
  if (k === 'playpause') { togglePause(); if (!P.osd && !P.panel) showOSD(); return; }
  if (k === 'rew') return seek(-30);
  if (k === 'ff') return seek(30);
  if (k === 'last') { if (P.last) tune(P.last); else toast('Zatiaľ nie je posledný kanál'); return; }
  if (k === 'help') return openHelp();
  if (P.panel) {
    if (k === 'back' || k === 'bksp') return closePanel();
    if (k === 'ok') return activate(nav.cur);
    if (DIRS[k] && !move(k) && ((P.panel === 'list' && k === 'right') || (P.panel !== 'list' && k === 'left'))) closePanel();
    return;
  }
  if (P.osd) {
    armHide();
    if (k === 'back' || k === 'bksp') return hideOSD();
    if (k === 'ok') return activate(nav.cur);
    if (k === 'info') return;
    if (DIRS[k]) {
      if (nav.cur && nav.cur.id === 'seek' && (k === 'left' || k === 'right')) return seek(k === 'left' ? -30 : 30);
      move(k);
    }
    return;
  }
  if (P.error && k === 'ok') { hideStatus(); engine.retry(); return; }
  if (M.on) {
    if (k === 'left') { if (engine !== E1) swapPane(); return; }
    if (k === 'right') { if (engine !== E2) swapPane(); return; }
    if (k === 'back' || k === 'bksp') { endMulti(); toast('Jeden obraz'); return; }
  }
  switch (k) {
    case 'up': step(1); break;
    case 'down': step(-1); break;
    case 'left': openPanel('list'); break;
    case 'right': openPanel('prog'); break;
    case 'ok': showOSD('#cPlay'); break;
    case 'info': showBanner(); break;
    case 'back': case 'bksp': if (S.set.backMini === 'on') enterMini(); else closePlayer(); break;
    case 'stop': closePlayer(); break;
  }
}

/* ---------- Pointer & touch ---------- */
let suppressClick = false, swipe = null;
document.addEventListener('pointerdown', e => { document.body.classList.toggle('touch', e.pointerType === 'touch'); });
document.addEventListener('pointermove', e => {
  if (e.pointerType !== 'mouse') return;
  document.body.classList.remove('touch');
  if (P.open && !P.mini && !P.panel && modal.hidden) { if (!P.osd) showOSD(); else armHide(); }
  const el = e.target.closest && e.target.closest('.f');
  const root = activeRoot();
  if (el && el !== nav.cur && el.tagName !== 'INPUT' && !el.disabled && root && root.contains(el)) setFocus(el, { noScroll: true });
});
document.addEventListener('click', e => {
  if (suppressClick) return;
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  if (el.classList.contains('f')) setFocus(el, { noScroll: true });
  activate(el, e);
});
document.addEventListener('pointerdown', e => { if (GRAB && !(e.target.closest && e.target.closest('.org-row.grabbing'))) endGrab(); }, true);
document.addEventListener('dragstart', e => {
  const g = e.target.closest && e.target.closest('.grab');
  if (!g) return;
  endGrab();
  DRAG = { list: g.dataset.list, id: g.dataset.id };
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', g.dataset.id); } catch {}
  g.closest('.org-row').classList.add('dragging');
});
document.addEventListener('dragover', e => {
  if (!DRAG) return;
  const r = e.target.closest && e.target.closest('#orgList .org-row[data-row]');
  $$('.drop-before, .drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after'));
  if (!r) return;
  e.preventDefault();
  const b = r.getBoundingClientRect();
  r.classList.add(e.clientY < b.top + b.height / 2 ? 'drop-before' : 'drop-after');
  const pane = $('#orgRight');
  if (e.clientY < pane.getBoundingClientRect().top + 60) pane.scrollTop -= 12;
  else if (e.clientY > pane.getBoundingClientRect().bottom - 60) pane.scrollTop += 12;
});
document.addEventListener('drop', e => {
  if (!DRAG) return;
  const r = e.target.closest && e.target.closest('#orgList .org-row[data-row]');
  if (r) {
    e.preventDefault();
    const arr = listRef(DRAG.list), from = arr.indexOf(DRAG.id);
    let to = arr.indexOf(r.dataset.row) + (r.classList.contains('drop-after') ? 1 : 0);
    if (to > from) to--;
    GRAB = { list: DRAG.list, id: DRAG.id, digits: '' };
    grabTo(to);
    GRAB = null; save();
  }
});
document.addEventListener('dragend', () => { DRAG = null; $$('.dragging, .drop-before, .drop-after').forEach(x => x.classList.remove('dragging', 'drop-before', 'drop-after')); });
$('#orgRight').addEventListener('scroll', e => lazyNear(e.target, $('#orgList')), { passive: true });
$('#s-organize').addEventListener('scroll', e => lazyNear(e.target, $('#orgList')), { passive: true });
document.addEventListener('focusin', e => { const el = e.target; if (el.classList && el.classList.contains('f') && el !== nav.cur) setFocus(el, { noScroll: true }); });
let qT;
$('#q').addEventListener('input', () => { clearTimeout(qT); qT = setTimeout(renderResults, 180); });
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
player.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') swipe = { x: e.clientX, y: e.clientY }; });
player.addEventListener('pointerup', e => {
  if (!swipe) return;
  const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y; swipe = null;
  if (Math.abs(dy) > 70 && Math.abs(dx) < 90 && !e.target.closest('.panel')) {
    step(dy < 0 ? 1 : -1);
    suppressClick = true; setTimeout(() => { suppressClick = false; }, 60);
  }
});
player.addEventListener('dblclick', e => { if (!e.target.closest('[data-act], .panel') && !IS_TV) toggleFullscreen(); });
player.addEventListener('click', e => {
  if (engine.v.muted && S.set.muted !== 'on') { engine.v.muted = false; updateMuteBtn(); }
  if (suppressClick || e.target.closest('[data-act], .panel, .seek-labels')) return;
  if (P.panel) { closePanel(true); return; }
  if (M.on && !e.target.closest('.osd-bottom, .osd-top')) { const right = e.clientX > innerWidth / 2; if (right ? engine !== E2 : engine !== E1) { swapPane(); return; } }
  if (P.osd) hideOSD(); else showOSD();
});
let resizeT;
addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (S.screen === 'guide') renderGuide(true); if (S.screen === 'home') renderHome(); if (S.screen === 'channels') renderChannels(); if (S.screen === 'cat') renderCat(); }, 200); });

/* ---------- Clock ---------- */
setInterval(() => {
  const now = Date.now();
  $('#hClock').textContent = hm(now);
  if (P.open) {
    if (P.real) syncOffset();
    else if (P.paused) P.offset = Math.min(P.offset + 1, maxOffset());
    if (P.osd) renderOSD();
    if (P.subs !== 'off' && !P.paused && now % 4000 < 1000) { subI++; renderSubs(); }
  }
}, 1000);
setInterval(() => { if (!P.open) updateCaps(); updateGuideNow(); }, 30000);
/* Reminders: a minute before the start, offer to switch. */
function checkReminders() {
  const now = Date.now();
  let changed = false;
  for (const k of [...S.rem]) {
    const i = k.lastIndexOf(':'), id = k.slice(0, i), start = +k.slice(i + 1);
    if (now - start > 5 * 60e3 || !byId[id]) { S.rem.delete(k); changed = true; continue; }
    if (start - now > 60e3) continue;
    S.rem.delete(k); changed = true;
    if (P.open && P.ch === id) continue;
    const p = findProg(id, start), ch = byId[id];
    if (!modal.hidden) { toast(`Začína: ${p.title} na ${ch.name}`); continue; }
    openModal(`<h2>Začína relácia</h2><div class="cm-head">${tileStatic(ch, 'mini')}<div><b class="cm-title">${esc(p.title)}</b><p class="muted">${esc(ch.name)} · ${hm(p.start)} – ${hm(p.end)}</p></div></div>
      <div class="actions"><button class="btn primary f" data-act="m-play" data-ch="${id}">${I('play')}Pozerať</button><button class="btn f" data-act="close-modal">Zavrieť</button></div>`);
    break;
  }
  if (changed) store.set('rem:' + S.libKey, [...S.rem]);
}
setInterval(checkReminders, 15000);

/* ---------- Boot ---------- */
if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');
applySettings();
$('#hClock').textContent = hm(Date.now());
requestAnimationFrame(waves);
$('#s-channels').addEventListener('scroll', e => lazyNear(e.target, $('#chGrid')), { passive: true });
$('#s-cat').addEventListener('scroll', e => lazyNear(e.target, $('#catGrid')), { passive: true });
$('#gScroll').addEventListener('scroll', () => { if (!G.raf) G.raf = requestAnimationFrame(() => { G.raf = 0; fillGuideRows(); }); }, { passive: true });
applyVolume();
if (IS_TV) document.documentElement.classList.add('tv');
(async () => {
  await detectRelay();
  if (canRecord()) { $('#navRecs').hidden = false; refreshRecs(); }
  let L = null, E = null;
  try { L = await library.getLibrary(); if (L) E = await library.getEpg(); } catch (e) { console.warn(e); }
  if (L && L.channels && L.channels.length) useLibrary(L, E); else useDemo();
  go('home');
  if (L && S.set.resume === 'on' && S.recent[0] && byId[S.recent[0]]) openPlayer(S.recent[0]);
  if (L) {
    if (Date.now() - (L.updated || 0) > 12 * 3600e3) importPlaylist(L.source, { silent: true });
    else if (!L.epgUpdated || Date.now() - L.epgUpdated > 8 * 3600e3) refreshEpg();
  }
})();
// Handy in the browser console when something misbehaves: vysielac.engine.tracks(), vysielac.P …
window.vysielac = { get engine() { return engine; }, P, S, M: () => M, importPlaylist, get channels() { return CH; } };
