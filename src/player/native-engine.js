// Android app: the same interface as Engine (engine.js), but playback is done by ExoPlayer in the app
// (android/…/NativePlayerPlugin.java). The picture is drawn under the web view; the page stays on top with its
// controls, and keeps the <video> element only as a placeholder whose position the native picture follows.
// `v` mimics the bits of HTMLVideoElement the app reads (currentTime, paused, muted, buffered…).

import { registerPlugin } from '@capacitor/core';
import { probe, guessKind } from '../data/net.js';
import { langLabel } from './engine.js';

const NP = registerPlugin('NativePlayer');
const SOFT = new Set();   // channels that needed the app's own audio decoder (remembered until restart)
const engines = new Map();
let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  NP.addListener('state', e => engines.get(e.id)?.onNative(e));
  NP.addListener('tracks', e => engines.get(e.id)?.onTracksEvent(e));
  NP.addListener('time', e => engines.get(e.id)?.onTime(e));
  // A tap on the native picture of the mini player (it lies above the page there) enlarges it.
  NP.addListener('tap', () => document.querySelector('#miniBar .mini-hit')?.click());
}

const ranges = (a, b) => ({ length: b > a ? 1 : 0, start: () => a, end: () => b });

class NativeVideo {
  constructor(eng, el) { this.e = eng; this.el = el; this._muted = false; this._volume = 1; }
  get classList() { return this.el.classList; }
  get id() { return this.el.id; }
  get currentTime() { return this.e.t.pos || 0; }
  set currentTime(sec) { this.e.t.pos = sec; NP.seek({ id: this.e.nid, pos: sec }).catch(() => {}); }
  get paused() { return !this.e.t.want; }
  get duration() { const t = this.e.t; return t.live ? Infinity : t.dur > 0 ? t.dur : NaN; }
  get buffered() { const t = this.e.t; return ranges(t.live && t.seekable ? 0 : Math.min(t.pos || 0, t.buf || 0), t.buf || 0); }
  get seekable() { const t = this.e.t; return t.seekable && t.dur > 0 ? ranges(0, t.dur) : ranges(0, 0); }
  get readyState() { const s = this.e.nstate; return s === 'playing' || s === 'ready' ? 4 : s === 'buffering' ? 2 : 0; }
  get videoWidth() { return this.e.tr.w || 0; }
  get videoHeight() { return this.e.tr.h || 0; }
  get currentSrc() { return this.e.src ? this.e.src.url : ''; }
  get muted() { return this._muted; }
  set muted(m) { this._muted = !!m; this.e.sendVolume(); }
  get volume() { return this._volume; }
  set volume(v) { this._volume = v; this.e.sendVolume(); }
  getVideoPlaybackQuality() { return { droppedVideoFrames: this.e.t.dropped || 0, totalVideoFrames: this.e.t.frames || 0 }; }
  requestPictureInPicture() { return Promise.reject(new Error('PiP')); }
  addEventListener() {}
  pause() { NP.pause({ id: this.e.nid }).catch(() => {}); this.e.t.want = false; }
  play() { NP.play({ id: this.e.nid }).catch(() => {}); this.e.t.want = true; return Promise.resolve(); }
}

let nextId = 1;
export class NativeEngine {
  constructor(el, cb = {}) {
    wire();
    this.nid = nextId++;
    engines.set(this.nid, this);
    this.el = el;
    this.v = new NativeVideo(this, el);
    this.cb = cb;
    this.state = 'idle'; this.nstate = 'idle';
    this.src = null; this.token = 0; this.kind = ''; this.via = '';
    this.t = {}; this.tr = { audio: [], text: [], video: [] };
    this.attempt = 0; this.everPlayed = false; this.stalls = 0; this.holding = false;
    this.lastLayout = '';
    this.lastPos = -1; this.lastProgress = 0;
    setInterval(() => this.layout(), 250);
    setInterval(() => this.watch(), 1000);
  }

  set(state, info) {
    if (this.state === state && !info) return;
    this.state = state;
    this.cb.onState?.(state, info || {});
  }

  async open(src) {
    const token = ++this.token;
    clearTimeout(this.retryT);
    this.src = { live: true, ...src };
    this.attempt = 0; this.everPlayed = false; this.stalls = 0;
    this.t = {}; this.tr = { audio: [], text: [], video: [] };
    this.set('loading');
    this.lastProgress = Date.now(); this.lastPos = -1;
    await this.start(token);
  }

  async start(token) {
    const s = this.src;
    let kind = s.kind || guessKind(s.url);
    // A link without a telling extension: ask the relay what it is, ExoPlayer needs to know HLS up front.
    if (!kind) {
      try { kind = (await probe(s.url, s)).type; } catch { kind = ''; }
      if (token !== this.token) return;
      if (kind && kind !== 'unknown') { s.kind = kind; this.cb.onKind?.(kind); }
    }
    this.kind = kind || 'ts';
    this.via = 'ExoPlayer';
    this.layout(true);
    this.lastProgress = Date.now();
    try {
      await NP.open({ id: this.nid, url: s.url, ua: s.ua || '', ref: s.ref || '', kind: kind === 'unknown' ? '' : kind, startAt: s.startAt || 0, soft: !!s.soft || SOFT.has(s.url) });
    } catch (e) { this.fail('network', e.message); }
    this.sendVolume();
  }

  close() {
    ++this.token; clearTimeout(this.retryT);
    this.src = null; this.t = {};
    NP.stop({ id: this.nid }).catch(() => {});
    this.layout(true);
    this.set('idle');
  }

  sendVolume() { NP.volume({ id: this.nid, volume: this.v._muted ? 0 : this.v._volume }).catch(() => {}); }

  /** Keep the native picture exactly where the placeholder <video> element is on the page. */
  layout(force) {
    const el = this.el, r = el.getBoundingClientRect();
    const show = !!this.src && r.width > 2 && r.height > 2 && !el.closest('[hidden]');
    const front = !!el.closest('#player.mini');
    const fit = el.classList.contains('ar-fill') ? 'fill' : el.classList.contains('ar-zoom') ? 'zoom' : el.classList.contains('ar-43') ? '43' : 'fit';
    const key = show ? [r.left, r.top, r.width, r.height].map(Math.round).join(',') + front + fit : 'hidden';
    if (!force && key === this.lastLayout) return;
    this.lastLayout = key;
    document.documentElement.classList.toggle('native-video', [...engines.values()].some(e => e.lastLayout !== 'hidden' && e.lastLayout !== ''));
    NP.layout({ id: this.nid, show, x: r.left, y: r.top, w: r.width, h: r.height, dpr: devicePixelRatio || 1, front, fit }).catch(() => {});
  }

  onNative(e) {
    const prev = this.nstate;
    this.nstate = e.state;
    if (!this.src) return;
    if (e.state === 'error') { this.fail(e.type || 'network', [e.code, e.detail].filter(Boolean).join(': ')); return; }
    if (e.state === 'playing') {
      this.everPlayed = true; this.lastProgress = Date.now();
      if (this.attempt && !this.okT) this.okT = setTimeout(() => { this.okT = 0; if (this.state === 'playing') this.attempt = 0; }, 30000);
      this.set('playing');
    } else if (e.state === 'buffering') {
      if (prev === 'playing') this.stalls++;
      if (this.state !== 'loading') this.set('buffering');
    } else if (e.state === 'ended' && this.src.live) this.fail('network', 'Stream skončil');
  }
  onTracksEvent(e) { this.tr = e; this.cb.onTracks?.(); }
  onTime(e) {
    this.t = e;
    if (e.pos !== this.lastPos && e.playing) { this.lastPos = e.pos; this.lastProgress = Date.now(); }
  }

  /**
   * A channel that stays "loading" never reports an error by itself (a decoder that starts but gives nothing,
   * a stream ExoPlayer waits on). After a while: first try the app's own audio decoder, then reconnect, then give up.
   */
  watch() {
    if (!this.src || this.state === 'error' || this.state === 'idle' || this.state === 'reconnecting') return;
    if (!this.t.want && this.everPlayed) { this.lastProgress = Date.now(); return; }   // paused by the user
    const stuck = Date.now() - this.lastProgress;
    if (stuck < (this.everPlayed ? 12000 : 15000)) return;
    this.lastProgress = Date.now();
    const why = `stav ${this.nstate}, ${this.kind || '?'}${this.tracks().info.codecs ? ', ' + this.tracks().info.codecs : ''}, načítané ${this.ahead().toFixed(1)} s`;
    if (!this.everPlayed && !this.src.soft) { this.fail('codec', 'nerozbehol sa: ' + why); return; }
    // Never started even with the app's decoder: one more fresh connection, then say so (about 45 s in total).
    if (!this.everPlayed && this.attempt >= 1) { NP.stop({ id: this.nid }).catch(() => {}); this.set('error', { type: 'stall', never: true, detail: why }); return; }
    this.fail('stall', why);
  }

  fail(type, detail) {
    if (!this.src || this.state === 'error') return;
    // The device's decoder would not start: once more with the app's own (FFmpeg) audio decoders.
    if (type === 'codec' && !this.src.soft) {
      this.src.soft = true; SOFT.add(this.src.url);
      this.set('reconnecting', { attempt: 0, reason: 'codec', level: 'audio', detail });
      const token = ++this.token;
      this.start(token);
      return;
    }
    if (type === 'codec') { NP.stop({ id: this.nid }).catch(() => {}); this.set('error', { type, detail }); return; }
    this.attempt++;
    if (this.attempt > (this.everPlayed ? 8 : 3)) { NP.stop({ id: this.nid }).catch(() => {}); this.set('error', { type, detail }); return; }
    const delay = Math.min(10000, 1000 * 2 ** (this.attempt - 1));
    const s = this.src;
    if (!s.live) s.startAt = this.v.currentTime || s.startAt;
    this.set('reconnecting', { attempt: this.attempt, detail });
    const token = ++this.token;
    clearTimeout(this.retryT);
    this.retryT = setTimeout(() => { if (token !== this.token) return; this.cb.onReconnect?.(); this.start(token); }, delay);
  }
  retry() { if (this.src) this.open(this.src); }

  pause() { this.v.pause(); }
  resume() { this.v.play(); }

  // ---- positions (seconds) ----
  ahead() { const t = this.t; return Math.max(0, (t.buf || 0) - (t.pos || 0)); }
  earliest() { return this.t.seekable ? 0 : this.v.currentTime; }
  liveEdge() { const t = this.t; return t.seekable && t.dur > 0 ? t.dur : t.pos || 0; }
  behind() { if (!this.src || !this.src.live || !this.t.live) return null; return Math.max(0, this.liveEdge() - (this.t.pos || 0)); }
  canBack(sec) { return !!this.t.seekable && this.v.currentTime - sec >= this.earliest() + 0.3; }
  seekBy(d) {
    if (!this.t.seekable) return;
    const max = this.src && this.src.live ? this.liveEdge() : (this.t.dur > 0 ? this.t.dur - 1 : this.v.currentTime + d);
    const to = Math.max(this.earliest(), Math.min(max, this.v.currentTime + d));
    if (this.src && this.src.live && to >= this.liveEdge() - 1) { NP.live({ id: this.nid }).catch(() => {}); return; }
    this.v.currentTime = to;
  }
  playableEnd() { const t = this.t; return t.dur > 0 ? t.dur : t.buf || 0; }
  stats() { const t = this.t; return { ahead: this.ahead(), goal: 2.5, stalls: this.stalls, dropped: t.dropped || 0, frames: t.frames || 0, native: this.nstate, soft: !!(this.src && this.src.soft), codecs: this.tracks().info.codecs || '' }; }

  // ---- tracks ----
  tracks() {
    const tr = this.tr;
    const mime = m => (m || '').replace(/^audio\//, '').replace(/^video\//, '').toUpperCase();
    const out = { audio: [], text: [], quality: [], info: { via: this.via, kind: this.kind, w: tr.w || 0, h: tr.h || 0, remux: false } };
    out.audio = (tr.audio || []).map((t, i) => ({ id: i, label: langLabel(t.lang, t.label, i) + (t.ok ? '' : ' (nepodporované)'), lang: t.lang || '', on: t.on, sub: mime(t.mime) }));
    out.text = (tr.text || []).map((t, i) => ({ id: i, label: langLabel(t.lang, t.label, i), lang: t.lang || '', on: t.on }));
    const vids = (tr.video || []).filter(t => t.h);
    if (vids.length > 1) {
      const cur = vids.find(v => v.on);
      out.quality = [{ id: -1, label: 'Automaticky', sub: tr.autoQuality && cur ? `teraz ${cur.h}p` : 'podľa rýchlosti siete', on: !!tr.autoQuality }]
        .concat(vids.map((v, i) => ({ id: i, label: `${v.h}p`, sub: v.bitrate > 0 ? `${(v.bitrate / 1e6).toFixed(1)} Mb/s` : '', on: !tr.autoQuality && v.on, h: v.h })).sort((a, b) => b.h - a.h));
    }
    const v0 = (tr.video || []).find(v => v.on);
    if (v0 || out.audio.length) out.info.codecs = [v0 && mime(v0.mime), (tr.audio || []).find(a => a.on) && mime(tr.audio.find(a => a.on).mime)].filter(Boolean).join(' + ');
    return out;
  }
  setAudio(i) { const t = (this.tr.audio || [])[i]; if (t) NP.track({ id: this.nid, type: 'audio', group: t.group, index: t.index }).catch(() => {}); }
  setText(i) { const t = (this.tr.text || [])[i]; NP.track({ id: this.nid, type: 'text', group: t ? t.group : -1, index: t ? t.index : 0 }).catch(() => {}); }
  setQuality(i) {
    const vids = (this.tr.video || []).filter(t => t.h), t = vids[i];
    NP.track({ id: this.nid, type: 'video', group: t ? t.group : -1, index: t ? t.index : 0 }).catch(() => {});
  }
}
