// Recordings, done by the local server so they keep going with the browser (or the TV) switched off.
//   GET    /api/rec            list
//   POST   /api/rec            schedule {ch, chName, title, url, ua, ref, start, end} (start in the past = record now)
//   POST   /api/rec/stop?id=   finish a running recording early
//   DELETE /api/rec?id=        cancel a scheduled one, or delete a finished one with its file
//   GET    /api/rec/file?id=   the recorded file, with Range support so the player can seek
// Files and the schedule live in recordings/ next to the app (REC_DIR overrides it).
// A recording is captured as MPEG-TS parts (a dropped connection starts a new part), then joined into one
// MP4 with AAC sound, which every browser and TV can play and seek.

import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_UA, hasFfmpeg } from './proxy.js';

const DIR = process.env.REC_DIR || fileURLToPath(new URL('../recordings/', import.meta.url));
const DB = join(DIR, 'schedule.json');
const PRE = 60e3, POST = 120e3;              // start a minute early, run two minutes over: guides are rarely exact
const FF = () => process.env.FFMPEG || 'ffmpeg';

let items = [], log = () => {}, timer = 0;
const running = new Map();                  // id -> { proc, stopping }

function load() {
  try { items = JSON.parse(readFileSync(DB, 'utf8')).items || []; } catch { items = []; }
}
function save() {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(DB + '.tmp', JSON.stringify({ items }, null, 1));
  renameSync(DB + '.tmp', DB);
}
const safe = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').slice(0, 60);
const partPath = (it, n) => join(DIR, `${it.base}.part${n}.ts`);
const pub = it => ({ id: it.id, ch: it.ch, chName: it.chName, title: it.title, start: it.start, end: it.end, recStart: it.recStart || 0, status: it.status, size: it.size || 0, error: it.error || '', duration: it.duration || 0 });

function begin(it) {
  if (!hasFfmpeg()) { it.status = 'failed'; it.error = 'Na tomto PC nie je ffmpeg.'; save(); return; }
  mkdirSync(DIR, { recursive: true });
  it.parts = (it.parts || 0) + 1;
  if (!it.recStart) it.recStart = Date.now();
  it.status = 'recording';
  const args = ['-hide_banner', '-loglevel', 'error', '-fflags', '+genpts+discardcorrupt', '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
    '-user_agent', it.ua || DEFAULT_UA];
  if (it.ref) args.push('-headers', `Referer: ${it.ref}\r\n`);
  // All audio tracks are kept (languages), the picture is copied as it comes: recording costs almost no CPU.
  args.push('-i', it.url, '-map', '0:v:0?', '-map', '0:a?', '-c', 'copy', '-f', 'mpegts', '-y', partPath(it, it.parts));
  const proc = spawn(FF(), args, { stdio: ['pipe', 'ignore', 'pipe'] });
  const r = { proc, stopping: false, err: '' };
  running.set(it.id, r);
  proc.stderr.on('data', d => { r.err = (r.err + d).slice(-400); });
  proc.on('close', code => {
    running.delete(it.id);
    if (!r.stopping && Date.now() < it.end + POST - 5e3 && it.status === 'recording') {
      // The provider dropped us mid-programme: wait a little and continue in a new part.
      log(`● nahrávanie ${it.title}: spojenie prerušené (${code}), pokračujem`);
      if (it.parts < 40) { setTimeout(() => { if (it.status === 'recording' && !running.has(it.id)) begin(it); }, 4000); return; }
    }
    finalize(it, r.err);
  });
  save();
  log(`● nahrávam ${it.chName}: ${it.title}`);
}

function stop(it) {
  const r = running.get(it.id);
  if (!r) { if (it.status === 'recording') finalize(it); return; }
  r.stopping = true;
  try { r.proc.stdin.write('q'); } catch {}
  setTimeout(() => { try { r.proc.kill('SIGKILL'); } catch {} }, 5000);
}

function finalize(it, err = '') {
  const parts = [];
  for (let n = 1; n <= (it.parts || 0); n++) { const p = partPath(it, n); if (existsSync(p) && statSync(p).size > 50e3) parts.push(p); }
  if (!parts.length) { it.status = 'failed'; it.error = err.trim().split('\n').pop() || 'Stream sa nepodarilo nahrať.'; save(); return; }
  it.status = 'processing'; save();
  const out = join(DIR, `${it.base}.mp4`), list = join(DIR, `${it.base}.txt`);
  writeFileSync(list, parts.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
  const p = spawn(FF(), ['-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-map', '0:v:0?', '-map', '0:a?',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-y', out], { stdio: 'ignore' });
  p.on('close', code => {
    rmSync(list, { force: true });
    if (code === 0 && existsSync(out) && statSync(out).size > 50e3) {
      parts.forEach(f => rmSync(f, { force: true }));
      it.file = out;
    } else {
      // MPEG-TS can be joined byte by byte, so the recording is never lost even if MP4 conversion fails.
      const ts = join(DIR, `${it.base}.ts`);
      const w = createWriteStream(ts);
      (async () => { for (const f of parts) await new Promise(res => { const r = createReadStream(f); r.pipe(w, { end: false }); r.on('end', res); }); w.end(); })();
      w.on('finish', () => { parts.forEach(f => rmSync(f, { force: true })); it.file = ts; it.size = statSync(ts).size; save(); });
      rmSync(out, { force: true });
      it.file = ts;
    }
    it.status = 'done';
    it.size = existsSync(it.file) ? statSync(it.file).size : 0;
    it.duration = Math.round((Date.now() - it.recStart) / 1000);
    save();
    log(`✓ nahrávka hotová: ${it.title}`);
  });
}

function tick() {
  const now = Date.now();
  for (const it of items) {
    if (it.status === 'scheduled' && now >= it.start - PRE) {
      if (now >= it.end) { it.status = 'failed'; it.error = 'Server v čase relácie nebežal.'; save(); }
      else begin(it);
    } else if (it.status === 'recording' && now >= it.end + POST) stop(it);
  }
}

export function startRecorder(opts = {}) {
  if (timer) return;
  log = opts.log || log;
  load();
  // After a restart: continue what should still be recording, finish what is over.
  for (const it of items) {
    if (it.status === 'recording' || it.status === 'processing') { if (Date.now() < it.end + POST) begin(it); else finalize(it); }
  }
  timer = setInterval(tick, 5000);
  timer.unref?.();
}

const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const readBody = req => new Promise((ok, bad) => { let b = ''; req.on('data', d => { b += d; if (b.length > 1e5) req.destroy(); }); req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch (e) { bad(e); } }); req.on('error', bad); });

export async function handleRec(route, req, res, q) {
  startRecorder();
  const id = q.get('id');
  const it = id ? items.find(x => x.id === id) : null;
  if (route === 'rec' && req.method === 'GET') return json(res, 200, { ffmpeg: hasFfmpeg(), dir: DIR, items: items.map(pub) });
  if (route === 'rec' && req.method === 'POST') {
    let b; try { b = await readBody(req); } catch { return json(res, 400, { error: 'Neplatná požiadavka' }); }
    if (!/^https?:\/\//i.test(b.url || '') || !(b.end > Date.now())) return json(res, 400, { error: 'Chýba adresa alebo čas' });
    if (items.some(x => x.ch === b.ch && x.start === b.start && (x.status === 'scheduled' || x.status === 'recording'))) return json(res, 409, { error: 'Táto relácia sa už nahráva' });
    const start = Math.max(+b.start || Date.now(), 0);
    const nid = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const d = new Date(start);
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    const rec = { id: nid, ch: String(b.ch || ''), chName: String(b.chName || ''), title: String(b.title || 'Nahrávka'), url: b.url, ua: b.ua || '', ref: b.ref || '',
      start, end: +b.end, status: 'scheduled', base: `${stamp}_${safe(b.chName)}_${safe(b.title)}_${nid.slice(-4)}`, created: Date.now() };
    items.push(rec); save(); tick();
    return json(res, 200, pub(rec));
  }
  if (!it) return json(res, 404, { error: 'Nahrávka neexistuje' });
  if (route === 'rec/stop') { if (it.status === 'recording') { it.end = Math.min(it.end, Date.now()); stop(it); } return json(res, 200, pub(it)); }
  if (route === 'rec' && req.method === 'DELETE') {
    if (running.has(it.id)) { const r = running.get(it.id); r.stopping = true; r.proc.kill('SIGKILL'); }
    for (let n = 1; n <= (it.parts || 0); n++) rmSync(partPath(it, n), { force: true });
    if (it.file) rmSync(it.file, { force: true });
    items = items.filter(x => x !== it); save();
    return json(res, 200, { ok: true });
  }
  if (route === 'rec/file') {
    const f = it.file || (it.status === 'recording' ? partPath(it, it.parts) : '');
    if (!f || !existsSync(f)) return json(res, 404, { error: 'Súbor nahrávky chýba' });
    const size = statSync(f).size, type = f.endsWith('.mp4') ? 'video/mp4' : 'video/mp2t';
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (m) {
      const a = m[1] ? +m[1] : Math.max(0, size - +m[2]), z = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1;
      if (a >= size) { res.writeHead(416, { 'content-range': `bytes */${size}` }); res.end(); return; }
      res.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${a}-${z}/${size}`, 'content-length': z - a + 1 });
      createReadStream(f, { start: a, end: z }).pipe(res);
    } else {
      res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': size });
      createReadStream(f).pipe(res);
    }
    return;
  }
  json(res, 404, { error: 'Neznáma požiadavka' });
}
