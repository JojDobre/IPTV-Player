// Languages. The app is written in Slovak; in any other language every text that reaches the screen (text nodes,
// aria-label, placeholder, title) is swapped for its translation as it appears. English (i18n-en.js) is the default
// and the base: the other languages (i18n/<code>.json) translate it by the id of the Slovak original (i18n-id.js),
// and a text not translated yet shows in English.
// Keys with {0}, {1}… match texts built from parts ("{0} kanálov"); the parts are translated too.
// Missing translations are collected in window.__i18nMissing (for finding them while developing).

import { EN, EN_T } from './i18n-en.js';
import { textId } from './i18n-id.js';

/** The app's languages, each named in itself. */
export const UI_LANGS = [['en', 'English'], ['sk', 'Slovenčina'], ['cs', 'Čeština'], ['de', 'Deutsch'], ['pl', 'Polski'], ['hu', 'Magyar'],
  ['es', 'Español'], ['fr', 'Français'], ['it', 'Italiano'], ['pt', 'Português'], ['ru', 'Русский'], ['uk', 'Українська'], ['tr', 'Türkçe'],
  ['hi', 'हिन्दी'], ['zh', '中文（简体）'], ['ja', '日本語'], ['id', 'Bahasa Indonesia']];

const pick = () => {
  try { const s = JSON.parse(localStorage.getItem('vysielac2:settings3') || '{}'); if (UI_LANGS.some(l => l[0] === s.ui)) return s.ui; } catch {}
  return 'en';
};
export const LANG = pick();
export const isEn = LANG === 'en';
/** Anything but the Slovak original goes through the translator. */
export const translating = LANG !== 'sk';
/** For dates and numbers. */
export const LOCALE = { zh: 'zh-CN', pt: 'pt-PT' }[LANG] || LANG;

const exact = new Map();
// Templates indexed by their first literal characters, so a text is checked only against likely candidates.
const byHead = new Map(), loose = [];
const esc = s => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
function addTemplate(sk, out) {
  // {#0} is a number (counts), {0} any text.
  const re = new RegExp('^' + esc(sk).replace(/\\?\{(#?)(\d)\\?\}/g, (_, num) => (num ? '([\\d][\\d\\s.,]*)' : '(.+?)')) + '$', 's');
  const order = [...sk.matchAll(/\{#?(\d)\}/g)].map(m => +m[1]);
  const head = sk.split('{')[0].slice(0, 3);
  const item = { re, en: out, order };
  if (head.length < 3) loose.push(item); else (byHead.get(head) || byHead.set(head, []).get(head)).push(item);
}
let done = new Set();
/** Loads the chosen language (only that one is downloaded) before the app starts. */
export async function loadLang() {
  if (!translating) return;
  let T = {};
  if (LANG !== 'en') { try { T = (await import(`./i18n/${LANG}.json`)).default; } catch (e) { console.warn('language', LANG, e); } }
  for (const [sk, en] of Object.entries(EN)) exact.set(sk, T[textId(sk)] ?? en);
  for (const [sk, en] of Object.entries(EN_T)) addTemplate(sk, T[textId(sk)] ?? en);
  done = new Set([...exact.values(), ...loose.map(x => x.en), ...[...byHead.values()].flat().map(x => x.en)]);
}
/** Marks text that is already in the chosen language (e.g. Intl dates) so it is not reported as missing. */
export const known = s => (done.add(s), s);
const missing = (window.__i18nMissing = new Set());
const SK_HINT = /[áäčďéíĺľňóôŕšťúýž]/i;

export function tr(s) {
  if (!translating || !s) return s;
  const core = s.trim();
  if (!core || !/\p{L}/u.test(core)) return s;
  let out = exact.get(core);
  if (out === undefined && done.has(core)) return s;   // already translated text passing through again
  if (out === undefined) {
    const cands = (byHead.get(core.slice(0, 3)) || []).concat(loose);
    for (const c of cands) {
      const m = c.re.exec(core);
      if (!m) continue;
      const parts = c.order.map((_, i) => m[i + 1]);
      out = c.en.replace(/\{(\d)\}/g, (_, k) => tr(parts[c.order.indexOf(+k)] ?? ''));
      break;
    }
  }
  // Texts joined with " · " (channel · programme · time): translate each part.
  if (out === undefined && core.includes(' · ')) { const parts = core.split(' · '), t = parts.map(x => tr(x)); if (t.some((x, i) => x !== parts[i])) out = t.join(' · '); }
  if (out === undefined) { if (SK_HINT.test(core) && core.length < 400 && !done.has(core)) missing.add(core); return s; }
  done.add(out);   // its own output may pass through again (the page changed); that is not a missing text
  return core === s ? out : s.replace(core, out);
}

const ATTRS = ['aria-label', 'placeholder', 'title'];
function trNode(n) {
  if (n.nodeType === 3) { if (n.parentElement && n.parentElement.closest('[data-notr]')) return; const v = n.nodeValue, t = tr(v); if (t !== v) n.nodeValue = t; return; }
  if (n.nodeType !== 1 || n.closest('[data-notr], script, style, textarea, input:not([placeholder])')) return;
  const els = [n, ...n.querySelectorAll('[aria-label], [placeholder], [title]')];
  for (const el of els) for (const a of ATTRS) { const v = el.getAttribute(a); if (v) { const t = tr(v); if (t !== v) el.setAttribute(a, t); } }
  const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT, { acceptNode: t => (t.parentElement && t.parentElement.closest('[data-notr], script, style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  for (let t; (t = w.nextNode());) { const v = t.nodeValue, r = tr(v); if (r !== v) t.nodeValue = r; }
}

/** Translate what is on the page now and everything added later. */
export function installTranslator() {
  if (!translating) return;
  document.documentElement.lang = LOCALE;
  document.title = tr(document.title);
  trNode(document.body);
  new MutationObserver(muts => {
    for (const m of muts) {
      if (m.type === 'characterData') trNode(m.target);
      else if (m.type === 'attributes') { const v = m.target.getAttribute(m.attributeName); if (v) { const t = tr(v); if (t !== v) m.target.setAttribute(m.attributeName, t); } }
      else for (const n of m.addedNodes) trNode(n);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
