// Playback engine. One <video> element, three ways to feed it:
//   HLS      → hls.js (MSE) on PC browsers, the built-in player on webOS / Safari
//   MPEG-TS  → mpegts.js (MSE) on PC browsers, the built-in player on webOS
//   anything else → the browser directly
// A watchdog notices a frozen picture and recovers on its own: first by jumping small gaps in the
// buffer, then by reconnecting with back-off. Audio the browser cannot decode (AC-3, E-AC-3, MP2)
// is retried through the relay's ffmpeg remux when available.

import { streamUrl, remuxUrl, probe, guessKind, useRelay, relayHasFfmpeg } from '../data/net.js';

let HlsMod, TsMod;
const loadHls = async () => (HlsMod ||= (await import('hls.js')).default);
const loadTs = async () => (TsMod ||= (await import('mpegts.js')).default);

const ua = navigator.userAgent;
const isTV = /Web0S|webOS|SmartTV|Tizen/i.test(ua);
const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
const preferNative = isTV || isSafari;

const LANG = { sk: 'Slovenčina', slk: 'Slovenčina', slo: 'Slovenčina', cs: 'Čeština', ces: 'Čeština', cze: 'Čeština', en: 'English', eng: 'English',
  de: 'Deutsch', deu: 'Deutsch', ger: 'Deutsch', hu: 'Magyar', hun: 'Magyar', pl: 'Polski', pol: 'Polski', uk: 'Українська', ukr: 'Українська',
  ru: 'Русский', rus: 'Русский', fr: 'Français', fra: 'Français', fre: 'Français', es: 'Español', spa: 'Español', it: 'Italiano', ita: 'Italiano',
  hr: 'Hrvatski', srp: 'Srpski', sr: 'Srpski', ro: 'Română', ron: 'Română', und: '', mis: '', qaa: 'Pôvodné znenie', mul: 'Viac jazykov' };
export const langLabel = (lang, name, i) => (name && !/^(audio|stereo|track|stopa)?[\s_-]*\d*$/i.test(name) ? name : '') || LANG[(lang || '').toLowerCase()] || (lang ? lang.toUpperCase() : `Stopa ${i + 1}`);
export const langMatches = (lang, pref) => {
  const l = (lang || '').toLowerCase();
  return { sk: ['sk', 'slk', 'slo'], cs: ['cs', 'ces', 'cze'], en: ['en', 'eng'], orig: ['qaa', 'orig', 'original'] }[pref]?.includes(l) || false;
};

const CODEC_ERRORS = /codec|incompatible|unsupported|MediaMSEError|MSE|DecodeError|MEDIA_ERR_SRC_NOT_SUPPORTED|addSourceBuffer/i;

export class Engine {
  /**
   * @param {HTMLVideoElement} video
   * @param {{onState?: Function, onTracks?: Function}} cb
   */
  constructor(video, cb = {}) {
    this.v = video;
    this.cb = cb;
    this.hls = null; this.ts = null;
    this.kind = ''; this.via = '';
    this.src = null; this.token = 0;
    this.state = 'idle';
    this.attempt = 0; this.mediaRecover = 0;
    this.lastT = 0; this.lastProgress = 0; this.okSince = 0;
    this.retryT = 0;
    const v = video;
    v.addEventListener('playing', () => this.progressed());
    v.addEventListener('waiting', () => this.onWaiting());
    v.addEventListener('loadedmetadata', () => this.cb.onTracks?.());
    v.addEventListener('error', () => { if (this.src && !this.hls && !this.ts) this.fail(CODEC_ERRORS.test(v.error?.message || '') || v.error?.code === 4 ? 'codec' : 'media', v.error?.message || 'Chyba prehrávania'); });
    v.audioTracks?.addEventListener?.('addtrack', () => this.cb.onTracks?.());
    v.textTracks?.addEventListener?.('addtrack', () => this.cb.onTracks?.());
    setInterval(() => this.watch(), 1000);
  }

  set(state, info) {
    if (this.state === state && !info) return;
    this.state = state;
    this.cb.onState?.(state, info || {});
  }

  /** @param {{url: string, ua?: string, ref?: string, live?: boolean, kind?: string, startAt?: number}} src */
  async open(src) {
    const token = ++this.token;
    clearTimeout(this.retryT);
    this.teardown();
    this.src = { live: true, ...src };
    this.attempt = 0; this.mediaRecover = 0; this.everPlayed = false;
    this.goal = 2; this.stalls = 0; this.userPaused = false;
    this.set('loading');
    await this.start(token);
  }

  close() { ++this.token; clearTimeout(this.retryT); this.teardown(); this.src = null; this.set('idle'); }

  async start(token) {
    const s = this.src, v = this.v;
    this.lastT = -1; this.lastProgress = Date.now(); this.okSince = 0;
    let kind = s.remux ? 'ts' : s.kind || guessKind(s.url);
    if (!kind) {
      try { kind = (await probe(s.url, s)).type; } catch { kind = 'unknown'; }
      if (token !== this.token) return;
      if (kind === 'unknown') kind = 'ts';
      s.kind = kind;
      this.cb.onKind?.(kind);
    }
    this.kind = kind;
    // direct: our own server's file (recordings), no relay in between.
    const url = s.remux ? remuxUrl(s.url, s, s.remux === 'video') : s.direct ? s.url : streamUrl(s.url, s);

    try {
      if (kind === 'hls' && !preferNative) {
        const Hls = await loadHls();
        if (token !== this.token) return;
        if (Hls.isSupported()) return this.startHls(Hls, url);
      }
      if (kind === 'ts' && !preferNative) {
        const mpegts = await loadTs();
        if (token !== this.token) return;
        if (mpegts.isSupported()) return this.startTs(mpegts, url);
      }
    } catch (e) {
      console.warn('player module', e);
    }
    this.via = 'native';
    v.src = url;
    if (s.startAt) v.addEventListener('loadedmetadata', () => { v.currentTime = s.startAt; }, { once: true });
    this.hold(this.goal);
  }

  startHls(Hls, url) {
    const s = this.src;
    this.via = 'hls.js';
    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      startFragPrefetch: true,
      // Room behind the playhead for pause and rewinding live TV; enough ahead to ride out network hiccups.
      backBufferLength: s.live ? 900 : 120,
      maxBufferLength: 30,
      maxMaxBufferLength: 90,
      maxBufferSize: 120 * 1000 * 1000,
      maxBufferHole: 0.5,
      // Start in the best quality (home connections are fast); ABR still steps down if the network cannot keep up.
      abrEwmaDefaultEstimate: 20e6,
      abrBandWidthUpFactor: 0.8,
      capLevelToPlayerSize: false,
      liveSyncDurationCount: 3,
      liveMaxLatencyDurationCount: Infinity,
      liveDurationInfinity: true,
      capLevelToPlayerSize: true,
      abrEwmaDefaultEstimate: 4_000_000,
      nudgeMaxRetry: 6,
      manifestLoadingMaxRetry: 4, manifestLoadingRetryDelay: 600,
      levelLoadingMaxRetry: 6, levelLoadingRetryDelay: 600,
      fragLoadingMaxRetry: 6, fragLoadingRetryDelay: 400,
      startPosition: s.startAt || -1,
    });
    this.hls = hls;
    const E = Hls.Events;
    hls.on(E.MANIFEST_PARSED, () => { this.cb.onTracks?.(); this.hold(this.goal); });
    for (const ev of [E.AUDIO_TRACKS_UPDATED, E.AUDIO_TRACK_SWITCHED, E.SUBTITLE_TRACKS_UPDATED, E.SUBTITLE_TRACK_SWITCH, E.LEVEL_SWITCHED, E.LEVELS_UPDATED]) hls.on(ev, () => this.cb.onTracks?.());
    hls.on(E.ERROR, (_, d) => {
      if (!d.fatal) return;
      const codec = /codec|incompatible/i.test(d.details) || d.details === Hls.ErrorDetails.BUFFER_ADD_CODEC_ERROR;
      if (codec) return this.fail('codec', d.details);
      if (d.type === Hls.ErrorTypes.MEDIA_ERROR && this.mediaRecover < 2) {
        this.mediaRecover++;
        if (this.mediaRecover === 2) hls.swapAudioCodec();
        hls.recoverMediaError();
        return;
      }
      this.fail(d.type === Hls.ErrorTypes.NETWORK_ERROR ? 'network' : 'media', `${d.details}${d.response?.code ? ' ' + d.response.code : ''}`);
    });
    hls.loadSource(url);
    hls.attachMedia(this.v);
  }

  startTs(mpegts, url) {
    const s = this.src;
    this.via = 'mpegts.js';
    const p = mpegts.createPlayer(
      { type: 'mpegts', isLive: s.live !== false, url },
      {
        enableWorker: true,
        enableStashBuffer: true,
        stashInitialSize: 384 * 1024,
        lazyLoad: false,
        liveBufferLatencyChasing: false,
        liveSync: false,
        // Keep a few minutes behind the playhead for pause / rewind (browsers cap the buffer size anyway).
        autoCleanupSourceBuffer: true,
        autoCleanupMaxBackwardDuration: 240,
        autoCleanupMinBackwardDuration: 150,
        fixAudioTimestampGap: true,
        accurateSeek: false,
      },
    );
    this.ts = p;
    const E = mpegts.Events;
    p.on(E.ERROR, (type, detail, info) => {
      const msg = `${type} ${detail}${info?.code ? ' ' + info.code : ''}${info?.msg ? ': ' + info.msg : ''}`;
      this.fail(CODEC_ERRORS.test(msg) && type !== 'NetworkError' ? 'codec' : type === 'NetworkError' ? 'network' : 'media', msg);
    });
    p.on(E.MEDIA_INFO, () => this.cb.onTracks?.());
    // A live stream whose download "completes" has been dropped by the server.
    p.on(E.LOADING_COMPLETE, () => { if (s.live !== false && this.ts === p) this.fail('network', 'Server ukončil spojenie'); });
    p.attachMediaElement(this.v);
    p.load();
    this.hold(this.goal);
  }

  play() {
    const pr = this.v.play();
    if (pr && pr.catch) pr.catch(e => {
      if (e.name === 'NotAllowedError') { this.v.muted = true; this.v.play().catch(() => {}); this.cb.onMuted?.(); }
    });
  }
  pause() { this.userPaused = true; this.unhold(); this.v.pause(); }
  resume() { this.userPaused = false; this.play(); }

  // ---- buffering: live IPTV data arrives in bursts, so the picture starts only with a few seconds in reserve,
  // and every stall raises that reserve (2 → 3.5 → 5 … 8 s), the way set-top boxes do it.
  ahead() {
    const v = this.v, b = v.buffered, t = v.currentTime;
    for (let i = 0; i < b.length; i++) if (b.start(i) <= t + 0.3 && b.end(i) > t) return b.end(i) - t;
    return 0;
  }
  hold(goal) {
    this.unhold();
    const v = this.v, t0 = Date.now(), token = this.token;
    this.holding = true;
    if (!v.paused) v.pause();
    const check = () => {
      if (token !== this.token || this.userPaused) { this.holding = false; this.holdT = 0; return; }
      // Archive/VOD with a known length does not need the full reserve once something is buffered.
      const enough = this.ahead() >= goal || (this.src && !this.src.live && v.readyState >= 3 && this.ahead() >= 1);
      if (enough || Date.now() - t0 > 8000) { this.holding = false; this.holdT = 0; this.play(); }
      else this.holdT = setTimeout(check, 150);
    };
    this.holdT = setTimeout(check, 150);
  }
  unhold() { clearTimeout(this.holdT); this.holdT = 0; this.holding = false; }
  onWaiting() {
    const v = this.v;
    if (!this.src || v.seeking || this.holding || this.userPaused || !this.everPlayed || this.state === 'reconnecting') return;
    this.stalls++;
    this.goal = Math.min(8, this.goal + 1.5);
    this.set('buffering');
    this.hold(this.goal);
  }
  stats() {
    const v = this.v, q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null;
    return { ahead: this.ahead(), goal: this.goal, stalls: this.stalls, dropped: q ? q.droppedVideoFrames : 0, frames: q ? q.totalVideoFrames : 0 };
  }

  teardown() {
    const v = this.v;
    this.unhold();
    if (this.hls) { try { this.hls.destroy(); } catch {} this.hls = null; }
    if (this.ts) { const p = this.ts; this.ts = null; try { p.pause(); p.unload(); p.detachMediaElement(); p.destroy(); } catch {} }
    v.removeAttribute('src');
    try { v.load(); } catch {}
    this.via = '';
  }

  /** Something went wrong: try the remux fallback for codec problems, otherwise reconnect with back-off. */
  fail(type, detail) {
    if (!this.src || this.state === 'error') return;
    const s = this.src;
    // Codec trouble: first convert only the sound (cheap), and if the picture still fails, the picture too.
    if (type === 'codec' && s.remux !== 'video' && useRelay() && relayHasFfmpeg()) {
      s.remux = s.remux ? 'video' : 'audio';
      this.set('reconnecting', { attempt: 0, reason: 'codec', level: s.remux, detail });
      const token = ++this.token;
      this.teardown();
      this.start(token);
      return;
    }
    if (type === 'codec') { this.teardown(); this.set('error', { type, detail }); return; }
    this.attempt++;
    // A channel that never started is most likely offline: give up quickly. One that was playing gets more patience.
    if (this.attempt > (this.everPlayed ? 8 : 3)) { this.teardown(); this.set('error', { type, detail }); return; }
    // The first pause is a full second: providers that allow one connection need a moment to release the old one.
    const delay = Math.min(10000, 1000 * 2 ** (this.attempt - 1));
    // Archive playback resumes where it stopped; live goes back to the live edge.
    if (!s.live) s.startAt = this.v.currentTime || s.startAt;
    this.set('reconnecting', { attempt: this.attempt, detail });
    const token = ++this.token;
    clearTimeout(this.retryT);
    this.retryT = setTimeout(() => { if (token !== this.token) return; this.teardown(); this.cb.onReconnect?.(); this.start(token); }, delay);
  }

  retry() { if (this.src) { const s = this.src; if (!relayHasFfmpeg()) s.remux = false; this.open(s); } }

  progressed() {
    this.lastProgress = Date.now();
    this.everPlayed = true;
    if (this.state !== 'playing') { this.okSince = Date.now(); this.set('playing'); }
  }

  watch() {
    const v = this.v;
    if (!this.src || this.state === 'error' || this.state === 'idle' || this.state === 'reconnecting') return;
    if (this.holding) { if (this.state === 'playing') this.set('buffering'); }
    if (v.paused) { this.lastProgress = Date.now(); return; }
    const t = v.currentTime;
    if (t !== this.lastT && v.readyState >= 3) {
      this.lastT = t;
      this.progressed();
      if (this.attempt && Date.now() - this.okSince > 30000) this.attempt = 0;
      return;
    }
    const stuck = Date.now() - this.lastProgress;
    if (stuck > 1500) {
      const b = v.buffered;
      for (let i = 0; i < b.length; i++) {
        if (b.start(i) > t && b.start(i) - t < 5) { v.currentTime = b.start(i) + 0.05; this.lastProgress = Date.now(); return; }
      }
    }
    if (stuck > 1200 && this.state === 'playing') this.set('buffering');
    if (stuck > (this.state === 'loading' ? 20000 : 10000)) { this.lastProgress = Date.now(); this.fail('stall', 'Obraz sa zastavil'); }
  }

  // ---- position helpers (seconds, in the media timeline) ----
  earliest() {
    const v = this.v, s = v.seekable, b = v.buffered;
    if (this.hls && s.length) return s.start(0);
    return b.length ? b.start(0) : v.currentTime;
  }
  liveEdge() {
    const v = this.v;
    if (this.hls && this.hls.liveSyncPosition) return this.hls.liveSyncPosition;
    const s = v.seekable;
    if (this.hls && s.length) return s.end(s.length - 1);
    const b = v.buffered;
    return b.length ? b.end(b.length - 1) : v.currentTime;
  }
  /** Seconds behind the live edge, or null when unknown. */
  behind() {
    if (!this.src || !this.src.live || this.v.readyState < 1) return null;
    return Math.max(0, this.liveEdge() - this.v.currentTime);
  }
  canBack(sec) { return this.v.currentTime - sec >= this.earliest() + 0.3; }
  seekBy(d) {
    const v = this.v;
    const max = this.src && this.src.live ? this.liveEdge() : (Number.isFinite(v.duration) ? v.duration - 1 : v.currentTime + d);
    v.currentTime = Math.max(this.earliest(), Math.min(max, v.currentTime + d));
  }
  /** End of what can be played without reloading (archive streams). */
  playableEnd() {
    const v = this.v;
    if (Number.isFinite(v.duration) && v.duration > 0) return v.duration;
    const s = v.seekable;
    if (s.length) return s.end(s.length - 1);
    const b = v.buffered;
    return b.length ? b.end(b.length - 1) : v.currentTime;
  }

  // ---- tracks ----
  tracks() {
    const out = { audio: [], text: [], quality: [], info: { via: this.via, kind: this.kind, w: this.v.videoWidth, h: this.v.videoHeight, remux: !!(this.src && this.src.remux) } };
    const h = this.hls, v = this.v;
    if (h) {
      out.audio = h.audioTracks.map((t, i) => ({ id: i, label: langLabel(t.lang, t.name, i), lang: t.lang || '', on: i === h.audioTrack }));
      out.text = h.subtitleTracks.map((t, i) => ({ id: i, label: langLabel(t.lang, t.name, i), lang: t.lang || '', on: i === h.subtitleTrack }));
      if (h.levels.length > 1) {
        out.quality = [{ id: -1, label: 'Automaticky', sub: h.autoLevelEnabled && h.levels[h.currentLevel] ? `teraz ${h.levels[h.currentLevel].height}p` : 'podľa rýchlosti siete', on: h.autoLevelEnabled }]
          .concat(h.levels.map((l, i) => ({ id: i, label: l.height ? `${l.height}p` : `Kvalita ${i + 1}`, sub: l.bitrate ? `${(l.bitrate / 1e6).toFixed(1)} Mb/s` : '', on: !h.autoLevelEnabled && i === h.currentLevel, h: l.height || 0 }))
            .sort((a, b) => b.h - a.h));
      }
    } else {
      if (v.audioTracks && v.audioTracks.length) out.audio = Array.from(v.audioTracks).map((t, i) => ({ id: i, label: langLabel(t.language, t.label, i), lang: t.language || '', on: t.enabled }));
      const tt = Array.from(v.textTracks || []).filter(t => t.kind === 'subtitles' || t.kind === 'captions');
      out.text = tt.map((t, i) => ({ id: i, label: langLabel(t.language, t.label, i), lang: t.language || '', on: t.mode === 'showing' }));
    }
    return out;
  }
  setAudio(id) {
    if (this.hls) this.hls.audioTrack = id;
    else if (this.v.audioTracks) Array.from(this.v.audioTracks).forEach((t, i) => { t.enabled = i === id; });
    this.cb.onTracks?.();
  }
  setText(id) {
    if (this.hls) { this.hls.subtitleTrack = id; this.hls.subtitleDisplay = id >= 0; }
    else Array.from(this.v.textTracks || []).filter(t => t.kind === 'subtitles' || t.kind === 'captions').forEach((t, i) => { t.mode = i === id ? 'showing' : 'disabled'; });
    this.cb.onTracks?.();
  }
  setQuality(id) {
    if (!this.hls) return;
    this.hls.currentLevel = id;
    this.cb.onTracks?.();
  }
}
